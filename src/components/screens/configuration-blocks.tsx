import * as React from "react";
import { cn } from "@/lib/utils";

/* V10 building blocks of the Configuration sections: section header, group card, field rows. */

export function SectionHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <>
      <h2 className="mb-1 font-display text-[22px] font-light text-hms-blue">{title}</h2>
      <p className="mb-[22px] max-w-[600px] text-[13px] leading-[1.55] text-fg-muted">{desc}</p>
    </>
  );
}

export function GroupCard({
  label,
  tag,
  tagTone = "warning",
  action,
  children,
}: {
  label: string;
  tag?: string;
  tagTone?: "warning" | "info";
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4 overflow-hidden rounded-lg border border-border bg-white">
      <header className="flex items-center gap-[9px] border-b border-border bg-[#FCFCFD] px-4 py-3">
        <h3 className="text-[13px] font-bold text-hms-blue">{label}</h3>
        {tag && (
          <span
            className={cn(
              "inline-flex items-center whitespace-nowrap rounded-full border px-[7px] py-[2px] text-[11px] font-bold",
              tagTone === "warning"
                ? "border-warning-border bg-warning-bg text-warning-text"
                : "border-[#C9DEF0] bg-[#EAF3FB] text-hms-accent",
            )}
          >
            {tag}
          </span>
        )}
        {action && <div className="ml-auto">{action}</div>}
      </header>
      <div className="px-4 pb-[14px] pt-[6px]">{children}</div>
    </section>
  );
}

export function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pending-field flex items-start gap-4 border-b border-[#F2F3F4] py-[11px]">
      <div className="w-[210px] shrink-0 pt-[5px]">
        <div className="pending-label text-[12.5px] font-bold text-text-body">{label}</div>
        {hint && <div className="mt-[2px] text-[11px] leading-[1.45] text-fg-subtle">{hint}</div>}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function ReadOnly({ value }: { value: string }) {
  return <div className="py-[6px] font-mono text-[12.5px] text-hms-blue">{value}</div>;
}
