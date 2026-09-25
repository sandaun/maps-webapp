"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** md: 30 px field; sm: 28 px, for tables and panels. */
  size?: "md" | "sm";
  /** Unit shown inside the field, right-aligned (s, ms, °C…). */
  unit?: string;
  /** Magnifier on the left, for search and filter fields. */
  search?: boolean;
}

/**
 * V14 input (1b style, matching `Select`): grey field without border at rest,
 * white with a blue ring on focus, red border when `aria-invalid` (also while
 * focused). `type="number"` renders a text field without native arrows: ↑ ↓
 * step by 1 in the last decimal place, Shift ×10, clamped to `min`/`max`; the
 * mouse wheel never changes it, and characters that cannot form a number are
 * ignored. Passwords get a show/hide button and read-only
 * fields a lock. With a unit, icon or button, `className` and `style` size the
 * wrapper; otherwise the input itself.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, style, type, size = "md", unit, search, readOnly, disabled, min, max, step, onChange, onKeyDown, ...props }, ref) => {
    const [revealed, setRevealed] = React.useState(false);
    const numeric = type === "number";
    const password = type === "password";
    const invalid = props["aria-invalid"] === true || props["aria-invalid"] === "true";
    const sm = size === "sm";
    const wrapped = !!unit || !!search || password || !!readOnly;

    const stepValue = (el: HTMLInputElement, dir: 1 | -1, big: boolean) => {
      const raw = el.value.trim();
      if (!/^-?\d*(\.\d+)?$/.test(raw)) return;
      const decimals = (raw.split(".")[1] ?? "").length;
      let next = (Number.parseFloat(raw) || 0) + dir * (big ? 10 : 1) * 10 ** -decimals;
      if (min !== undefined && next < Number(min)) next = Number(min);
      if (max !== undefined && next > Number(max)) next = Number(max);
      const text = next.toFixed(decimals);
      if (text === raw) return;
      // Through the native setter so React sees a real input event.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };

    const input = (
      <input
        {...props}
        ref={ref}
        type={numeric ? "text" : password && revealed ? "text" : type}
        inputMode={numeric ? "decimal" : props.inputMode}
        min={numeric ? undefined : min}
        max={numeric ? undefined : max}
        step={numeric ? undefined : step}
        readOnly={readOnly}
        disabled={disabled}
        onChange={(event) => {
          // Like a native number field: characters that cannot form a number are ignored.
          if (numeric && !/^-?\d*(\.\d*)?$/.test(event.target.value)) return;
          onChange?.(event);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || !numeric || readOnly) return;
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            stepValue(event.currentTarget, event.key === "ArrowUp" ? 1 : -1, event.shiftKey);
          }
        }}
        style={wrapped ? undefined : style}
        className={cn(
          "w-full min-w-0 rounded-[6px] border text-text-body outline-none transition-[border-color,background-color,box-shadow] duration-[120ms] placeholder:text-[#8A969F]",
          sm ? "h-7 px-[9px] text-[12px]" : "h-[30px] px-[10px] text-[12.5px]",
          numeric && "font-mono",
          search && (sm ? "pl-[28px]" : "pl-[30px]"),
          (unit || password || readOnly) && (sm ? "pr-7" : "pr-[30px]"),
          disabled
            ? "cursor-not-allowed border-transparent bg-[#F5F6F7] text-[#A3ADB4]"
            : readOnly
              ? "border-[#E1E5E8] bg-transparent text-fg-muted"
              : invalid
                ? "border-error bg-[#F1F3F5] hover:bg-[#E9EDF0] focus:bg-white focus:shadow-[0_0_0_3px_rgba(176,58,46,.16)]"
                : "border-transparent bg-[#F1F3F5] hover:bg-[#E9EDF0] focus:border-hms-accent focus:bg-white focus:shadow-[0_0_0_3px_rgba(18,104,179,.16)]",
          !wrapped && className,
        )}
      />
    );
    if (!wrapped) return input;

    return (
      <div className={cn("relative w-full min-w-0", className)} style={style}>
        {search && (
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            aria-hidden
            className={cn("pointer-events-none absolute top-1/2 -translate-y-1/2 text-fg-subtle", sm ? "left-[9px]" : "left-[10px]")}
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
        )}
        {input}
        {unit && !password && !readOnly && (
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-y-0 flex items-center font-mono text-[11.5px]",
              sm ? "right-[9px]" : "right-[10px]",
              disabled ? "text-[#C3CAD0]" : "text-fg-subtle",
            )}
          >
            {unit}
          </span>
        )}
        {readOnly && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#9AA5AD"
            strokeWidth="2.2"
            aria-hidden
            className={cn("pointer-events-none absolute top-1/2 -translate-y-1/2", sm ? "right-[9px]" : "right-[10px]")}
          >
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
        )}
        {password && !readOnly && (
          <button
            type="button"
            aria-label={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
            disabled={disabled}
            onClick={() => setRevealed((r) => !r)}
            className={cn(
              "absolute top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-fg-muted outline-none hover:text-text-body focus-visible:shadow-[0_0_0_2px_rgba(18,104,179,.45)] disabled:cursor-not-allowed disabled:text-[#C3CAD0]",
              sm ? "right-[3px]" : "right-1",
            )}
          >
            {revealed ? <EyeOff size={15} strokeWidth={1.9} /> : <Eye size={15} strokeWidth={1.9} />}
          </button>
        )}
      </div>
    );
  },
);
Input.displayName = "Input";

export { Input };
