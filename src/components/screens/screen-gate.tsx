"use client";

import * as React from "react";
import { useCurrentProject } from "@/lib/current-project";
import type { ProjectView } from "@/lib/project-types";
import type { ValidationIssue } from "@/core/validation/issue";
import { NoProjectState } from "@/components/no-project";
import { Badge } from "@/components/ui/badge";

/**
 * Shared page gate for project screens: renders the loading / "no project"
 * states, then the screen content with the loaded view.
 */
export function ScreenGate({ children }: { children: (view: ProjectView) => React.ReactNode }) {
  const { view, loading, error } = useCurrentProject();
  if (loading && !view) {
    return <p className="text-sm text-fg-muted">Loading project…</p>;
  }
  if (!view) {
    return (
      <div className="space-y-4">
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        <NoProjectState />
      </div>
    );
  }
  return <>{children(view)}</>;
}

const SEVERITY_BADGE = {
  error: "error",
  warning: "warning",
  info: "muted",
} as const satisfies Record<ValidationIssue["severity"], string>;

/** Inline list of the validation issues whose ref points at this screen. */
export function ScreenIssues({
  issues,
  screen,
}: {
  issues: ValidationIssue[];
  screen: NonNullable<ValidationIssue["ref"]>["screen"];
}) {
  const mine = issues.filter((issue) => issue.ref?.screen === screen);
  if (mine.length === 0) return null;
  return (
    <ul
      aria-label="Screen issues"
      className="space-y-1.5 rounded-lg border border-border bg-white px-4 py-3 shadow-sm"
    >
      {mine.map((issue, index) => (
        <li key={`${issue.code}-${index}`} className="flex items-start gap-2 text-[13px]">
          <Badge variant={SEVERITY_BADGE[issue.severity]}>{issue.code}</Badge>
          <span className="text-text-body">{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}
