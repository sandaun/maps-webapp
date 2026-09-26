"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ValidationIssue } from "@/core/validation/issue";
import { cn } from "@/lib/utils";

type IssueTab = "all" | "error" | "warning" | "info";

const TABS: { id: IssueTab; label: string; dot?: string }[] = [
  { id: "all", label: "All" },
  { id: "error", label: "Errors", dot: "#B03A2E" },
  { id: "warning", label: "Warnings", dot: "var(--color-warning)" },
  { id: "info", label: "Information", dot: "var(--color-hms-accent)" },
];

const SEV: Record<
  ValidationIssue["severity"],
  { border: string; iconBg: string; iconBorder: string; icon: string; color: string }
> = {
  error: {
    border: "#B03A2E",
    iconBg: "#FDF3F2",
    iconBorder: "#E8C4C0",
    icon: "!",
    color: "#B03A2E",
  },
  warning: {
    border: "#8A5A12",
    iconBg: "#FDF6EC",
    iconBorder: "#E8D3B4",
    icon: "!",
    color: "#8A5A12",
  },
  info: {
    border: "var(--color-hms-accent)",
    iconBg: "#EAF3FB",
    iconBorder: "#C9DEF0",
    icon: "i",
    color: "var(--color-hms-accent)",
  },
};

export function ValidationView({
  issues,
  family,
  onGoToSignal,
  onOpenConversions,
}: {
  issues: ValidationIssue[];
  family: "knx-mbm" | "me-mbs";
  onGoToSignal: (id: number) => void;
  /** KNX–MBM: open the conversions editor of a signal. */
  onOpenConversions?: (id: number) => void;
}) {
  const router = useRouter();
  const [tab, setTab] = React.useState<IssueTab>("all");
  const errors = issues.filter((i) => i.severity === "error");
  const visible = tab === "all" ? issues : issues.filter((i) => i.severity === tab);
  const subtitle =
    family === "knx-mbm"
      ? "signal table, group addresses and poll records"
      : "register map, group list and unit types";

  return (
    <div className="max-w-[1080px] px-6 py-[18px] pb-9">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex-1">
          <div className="font-display text-[20px] font-normal text-hms-blue">Configuration validation</div>
          <div className="mt-0.5 text-[12.5px] text-fg-muted">Checked just now · {subtitle}</div>
        </div>
        <button
          type="button"
          className="rounded-[4px] border border-border bg-white px-[13px] py-2 text-[12.5px] font-medium text-hms-blue hover:border-hms-accent"
          onClick={() => router.refresh()}
        >
          Re-run check
        </button>
        <button
          type="button"
          disabled={errors.length > 0}
          className={cn(
            "rounded-[4px] px-[14px] py-2 text-[12.5px] font-medium text-white",
            errors.length > 0 ? "cursor-pointer bg-[#C9CFD3]" : "bg-hms-accent hover:bg-hms-accent-hover",
          )}
          onClick={() => {
            if (errors.length === 0) router.push("/deploy");
          }}
        >
          {errors.length > 0 ? `Deploy blocked by ${errors.length} errors` : "Ready to deploy →"}
        </button>
      </div>

      <div className="mb-4 flex gap-2.5">
        {TABS.map((item) => {
          const on = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px]",
                on
                  ? "border-[#C9DEF0] bg-[#EAF3FB] font-medium text-hms-blue"
                  : "border-border bg-white font-normal text-fg-muted",
              )}
              onClick={() => setTab(item.id)}
            >
              {item.dot ? (
                <span className="size-[7px] rounded-full" style={{ background: item.dot }} />
              ) : null}
              {item.label}
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-fg-muted">No issues in this filter.</p>
      ) : (
        visible.map((issue, index) => {
          const sev = SEV[issue.severity];
          const signalId =
            issue.ref?.entity === "signal" && typeof issue.ref.id === "number" ? issue.ref.id : undefined;
          // Conversion issues jump to the place to fix them: the signal's editor or the library entry.
          const conversionEntry =
            issue.ref?.field === "conversion" && typeof issue.ref.id === "string" ? issue.ref.id : undefined;
          const openConversions = signalId !== undefined && issue.ref?.field === "conversions" && !!onOpenConversions;
          const goLabel = conversionEntry
            ? "Open conversion"
            : openConversions
              ? "Open conversions"
              : issue.ref?.screen === "devices"
              ? "Open devices"
              : issue.ref?.screen === "configuration"
                ? "Open configuration"
                : issue.ref?.screen === "deploy"
                  ? "Open deploy"
                  : signalId !== undefined
                    ? "Go to signal"
                    : undefined;
          return (
            <article
              key={`${issue.code}-${index}`}
              className="mb-2.5 flex gap-[13px] rounded-[6px] border border-border bg-white py-3.5 pr-4 pl-4"
              style={{ borderLeftWidth: 3, borderLeftColor: sev.border }}
            >
              <div
                className="flex size-[22px] shrink-0 items-center justify-center rounded-full border font-sans text-[12px] font-medium"
                style={{ color: sev.color, background: sev.iconBg, borderColor: sev.iconBorder }}
              >
                {sev.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium leading-[1.35] text-hms-blue">{issue.message}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {issue.ref?.id !== undefined ? (
                    <span
                      className="rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] font-semibold"
                      style={{ color: sev.color, background: sev.iconBg, borderColor: sev.iconBorder }}
                    >
                      {conversionEntry
                        ? `${conversionEntry.startsWith("f") ? "Filter" : "Operation"} ${Number(conversionEntry.slice(1)) + 1}`
                        : String(issue.ref.id)}
                    </span>
                  ) : null}
                  <span className="rounded-[3px] bg-hms-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-hms-blue">
                    {issue.code}
                  </span>
                </div>
                {goLabel ? (
                  <button
                    type="button"
                    className="mt-2.5 text-[12.5px] font-medium text-hms-accent"
                    onClick={() => {
                      if (conversionEntry) router.push(`/configuration?conversion=${conversionEntry}`);
                      else if (openConversions) onOpenConversions?.(signalId!);
                      else if (signalId !== undefined) onGoToSignal(signalId);
                      else if (issue.ref?.screen === "devices") router.push("/devices");
                      else if (issue.ref?.screen === "configuration") router.push("/configuration");
                      else if (issue.ref?.screen === "deploy") router.push("/deploy");
                    }}
                  >
                    {goLabel}
                  </button>
                ) : null}
              </div>
            </article>
          );
        })
      )}
    </div>
  );
}
