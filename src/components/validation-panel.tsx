"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, ShieldCheck } from "lucide-react";
import type { ValidationIssue, ValidationRef } from "@/core/validation/issue";
import { useCurrentProject } from "@/lib/current-project";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const SEVERITY_ORDER = ["error", "warning", "info"] as const;

const SEVERITY_BADGE = {
  error: "error",
  warning: "warning",
  info: "muted",
} as const satisfies Record<ValidationIssue["severity"], string>;

const NO_ISSUES: ValidationIssue[] = [];

function refPath(ref: ValidationRef): string {
  return [ref.screen, ref.entity, ref.id, ref.field]
    .filter((part) => part !== undefined && part !== "")
    .join(" / ");
}

/**
 * Collapsible validation drawer listing the current project's issues, grouped
 * by severity. Mounted once in the AppShell so it is available on every page.
 */
export function ValidationPanel() {
  const { view } = useCurrentProject();
  const [open, setOpen] = React.useState(false);
  const issues = React.useMemo(() => view?.issues ?? NO_ISSUES, [view]);

  const counts = React.useMemo(() => {
    const bySeverity = { error: 0, warning: 0, info: 0 };
    for (const issue of issues) bySeverity[issue.severity] += 1;
    return bySeverity;
  }, [issues]);

  if (!view) return null;

  return (
    <div className="fixed bottom-0 right-0 z-40 w-full max-w-md">
      {open && (
        <div className="max-h-80 overflow-y-auto border border-b-0 border-border bg-white shadow-lg">
          {issues.length === 0 ? (
            <p className="px-4 py-3 text-sm text-fg-muted">No validation issues.</p>
          ) : (
            SEVERITY_ORDER.map((severity) => {
              const group = issues.filter((i) => i.severity === severity);
              if (group.length === 0) return null;
              return (
                <section key={severity} aria-label={`${severity}s`} className="px-4 py-2">
                  <h4 className="py-1 font-mono text-[10.5px] font-medium uppercase tracking-wider text-fg-muted">
                    {severity}s ({group.length})
                  </h4>
                  <ul className="space-y-1.5 pb-1">
                    {group.map((issue, index) => (
                      <li key={`${issue.code}-${index}`} className="text-[13px]">
                        <div className="flex items-start gap-2">
                          <Badge variant={SEVERITY_BADGE[severity]}>{issue.code}</Badge>
                          <span className="text-text-body">{issue.message}</span>
                        </div>
                        {issue.ref && (
                          <div className="mt-0.5 pl-1 font-mono text-[11px] text-fg-subtle">
                            {refPath(issue.ref)}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center justify-between gap-2 border border-b-0 px-4 py-2 text-sm font-medium shadow-lg transition-colors",
          counts.error > 0
            ? "border-error/30 bg-error-bg text-error"
            : counts.warning > 0
              ? "border-warning/30 bg-warning-bg text-warning-text"
              : "border-border bg-white text-fg-muted",
        )}
      >
        <span className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          Validation
        </span>
        <span className="flex items-center gap-1.5">
          {counts.error > 0 && <Badge variant="error">{counts.error} errors</Badge>}
          {counts.warning > 0 && <Badge variant="warning">{counts.warning} warnings</Badge>}
          {counts.error === 0 && counts.warning === 0 && (
            <Badge variant="success">No issues</Badge>
          )}
          {open ? (
            <ChevronDown className="h-4 w-4" aria-hidden />
          ) : (
            <ChevronUp className="h-4 w-4" aria-hidden />
          )}
        </span>
      </button>
    </div>
  );
}
