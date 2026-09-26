"use client";

import * as React from "react";
import type { ValidationIssue } from "@/core/validation/issue";
import type { FamilyId } from "@/lib/project-types";
import { useCurrentProject } from "@/lib/current-project";
import { useSignalsTab } from "@/lib/signals-tabs";
import { cn } from "@/lib/utils";
import { ImportExportView } from "./import-export-view";
import { ValidationView } from "./validation-view";

type TabId = "map" | "validation" | "import";

export function SignalsPageChrome({
  issues,
  signalCount,
  family,
  children,
}: {
  issues: ValidationIssue[];
  signalCount: number;
  family: FamilyId;
  children: React.ReactNode;
}) {
  const { view, refresh } = useCurrentProject();
  const { tab, setTab } = useSignalsTab();
  const [checking, setChecking] = React.useState(false);
  const issueCount = issues.filter((i) => i.severity === "error" || i.severity === "warning").length;

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: "map", label: "Signal map", count: signalCount },
    { id: "validation", label: "Validation", count: issueCount || undefined },
    { id: "import", label: "Import & export" },
  ];

  React.useEffect(() => {
    if (!checking) return;
    const id = window.setTimeout(() => {
      setChecking(false);
      setTab("validation");
    }, 800);
    return () => window.clearTimeout(id);
  }, [checking, setTab]);

  return (
    <div className="-mx-6 -mt-6 flex min-h-0 flex-1 flex-col overflow-hidden">
      {checking ? (
        <div className="shrink-0 border-b border-[#C9DEF0] bg-[#EAF3FB] px-5 py-2 text-[12.5px] font-medium text-hms-blue">
          Checking the signal table… {signalCount} signals · registers, addressing, groups
        </div>
      ) : null}
      <div role="tablist" aria-label="Signals views" className="flex shrink-0 gap-1 border-b border-border bg-white px-6">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] transition-colors",
              tab === item.id
                ? "border-hms-accent font-bold text-hms-blue"
                : "border-transparent font-normal text-fg-muted hover:text-text-body",
            )}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.count !== undefined ? (
              <span
                className={cn(
                  "font-mono text-[11px]",
                  tab === item.id ? "font-medium text-hms-accent" : "font-normal text-fg-subtle",
                )}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {tab === "map" && (
        <div role="tabpanel" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {React.isValidElement(children)
            ? React.cloneElement(children as React.ReactElement<{ onCheckTable?: () => void }>, {
                onCheckTable: () => setChecking(true),
              })
            : children}
        </div>
      )}
      {tab === "validation" && (
        <div role="tabpanel" className="min-h-0 flex-1 overflow-auto">
          <ValidationView
            issues={issues}
            family={family}
            onGoToSignal={(id) => setTab("map", { signal: id })}
            onOpenConversions={
              family === "knx-mbm" ? (id) => setTab("map", { signal: id, editConversions: true }) : undefined
            }
          />
        </div>
      )}
      {tab === "import" && view && (
        <div role="tabpanel" className="min-h-0 flex-1 overflow-auto">
          <ImportExportView
            family={family}
            projectId={view.meta.id}
            projectName={view.meta.name}
            signalCount={signalCount}
            lastImport={view.meta.lastImport}
            onImported={() => void refresh()}
          />
        </div>
      )}
    </div>
  );
}
