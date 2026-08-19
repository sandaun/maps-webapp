"use client";

import * as React from "react";
import { Download, FileUp } from "lucide-react";
import type { ValidationIssue } from "@/core/validation/issue";
import { exportProjectUrl, openProjectFile } from "@/lib/api";
import { useCurrentProject } from "@/lib/current-project";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type TabId = "map" | "validation" | "import";

const TABS: { id: TabId; label: string }[] = [
  { id: "map", label: "Signal map" },
  { id: "validation", label: "Validation" },
  { id: "import", label: "Import & export" },
];

export function SignalsPageChrome({
  issues,
  children,
}: {
  issues: ValidationIssue[];
  children: React.ReactNode;
}) {
  const [tab, setTab] = React.useState<TabId>("map");

  return (
    <div className="-mx-6 -mt-6 flex min-h-0 flex-1 flex-col overflow-hidden">
      <div role="tablist" aria-label="Signals views" className="flex shrink-0 gap-1 border-b border-border bg-white px-6">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={cn(
              "border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors",
              tab === item.id
                ? "border-hms-accent text-hms-blue"
                : "border-transparent text-fg-muted hover:text-text-body",
            )}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === "map" && (
        <div role="tabpanel" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>
      )}
      {tab === "validation" && (
        <div role="tabpanel" className="min-h-0 flex-1 overflow-auto p-6">
          <ValidationTab issues={issues} />
        </div>
      )}
      {tab === "import" && (
        <div role="tabpanel" className="min-h-0 flex-1 overflow-auto p-6">
          <ImportTab />
        </div>
      )}
    </div>
  );
}

function ValidationTab({ issues }: { issues: ValidationIssue[] }) {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const infos = issues.filter((i) => i.severity === "info");

  if (issues.length === 0) {
    return <p className="text-sm text-fg-muted">No validation issues.</p>;
  }

  return (
    <div className="space-y-4">
      <IssueGroup title="Errors" items={errors} variant="error" />
      <IssueGroup title="Warnings" items={warnings} variant="warning" />
      <IssueGroup title="Info" items={infos} variant="muted" />
    </div>
  );
}

function IssueGroup({
  title,
  items,
  variant,
}: {
  title: string;
  items: ValidationIssue[];
  variant: "error" | "warning" | "muted";
}) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-lg border border-border bg-white px-4 py-3">
      <h3 className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-fg-muted">
        {title} ({items.length})
      </h3>
      <ul className="mt-2 space-y-1.5">
        {items.map((issue, index) => (
          <li key={`${issue.code}-${index}`} className="flex items-start gap-2 text-[13px]">
            <Badge variant={variant}>{issue.code}</Badge>
            <span>{issue.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ImportTab() {
  const { view, setProjectId } = useCurrentProject();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const meta = await openProjectFile(file);
      setProjectId(meta.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open the file");
    } finally {
      setBusy(false);
    }
  }

  const id = view?.meta.id;

  return (
    <div className="max-w-lg space-y-4">
      <p className="text-sm text-fg-muted">
        Import a local <span className="font-mono">.ibmaps</span> project or export the current one. Deploy is the
        only action that writes to a gateway.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".ibmaps,.xml,.zip"
        className="hidden"
        aria-label="Import project file"
        onChange={(e) => void handleFile(e)}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
          <FileUp className="h-3.5 w-3.5" aria-hidden />
          Import project
        </Button>
        {id && (
          <a href={exportProjectUrl(id)} className={buttonVariants({ variant: "secondary", size: "sm" })} download>
            <Download className="h-3.5 w-3.5" aria-hidden />
            Export project
          </a>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
