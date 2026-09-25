"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * Modal chrome from the v9 reference: header (title + description), body of
 * `ModalRow` fields, and a footer with a muted note, Cancel and one primary
 * action. Closes on Escape and on overlay click.
 */
export function Modal({
  title,
  description,
  foot,
  ctaLabel,
  ctaDisabled,
  onConfirm,
  onClose,
  width = 500,
  children,
}: {
  title: string;
  description?: string;
  /** Muted note on the left of the footer. */
  foot?: string;
  ctaLabel: string;
  ctaDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  width?: number;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={`Close ${title}`}
        className="absolute inset-0 cursor-default bg-[rgba(4,61,93,.28)]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label={title}
        className="relative w-full overflow-hidden whitespace-normal rounded-[8px] border border-border bg-white shadow-[0_18px_45px_rgba(4,61,93,.22)]"
        style={{ maxWidth: width }}
      >
        <div className="border-b border-border px-[22px] pb-[14px] pt-[18px]">
          <h2 className="font-display text-[19px] font-light text-hms-blue">{title}</h2>
          {description ? (
            <p className="mt-1 text-[12.5px] leading-[1.5] text-fg-muted">{description}</p>
          ) : null}
        </div>
        <div className="px-[22px] py-4">{children}</div>
        <div className="flex items-center gap-[9px] border-t border-border bg-card-foot px-[22px] py-[14px]">
          <p className="flex-1 text-[11.5px] text-fg-subtle">{foot}</p>
          <Button variant="secondary" size="sm" className="h-8" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" className="h-8" onClick={onConfirm} disabled={ctaDisabled}>
            {ctaLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Horizontal field row inside a `Modal`: label + hint on the left, control right. */
export function ModalRow({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-center gap-[14px] border-b border-row-rule py-[9px]", className)}>
      <div className="flex-1">
        <div className="text-[12.5px] font-bold text-text-body">{label}</div>
        {hint ? <div className="text-[11px] text-fg-subtle">{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}
