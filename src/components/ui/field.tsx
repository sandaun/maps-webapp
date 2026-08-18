import * as React from "react";
import { cn } from "@/lib/utils";

/** Labelled form field with an optional muted hint (design-reference style). */
export function Field({
  label,
  hint,
  htmlFor,
  className,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-text-body">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-fg-subtle">{hint}</p>}
    </div>
  );
}
