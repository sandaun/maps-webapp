"use client";

import * as React from "react";
import { Download, FileUp, FlaskConical, RefreshCw } from "lucide-react";
import { exportProjectUrl, listProjects, loadDemoProject, openProjectFile } from "@/lib/api";
import { useCurrentProject } from "@/lib/current-project";
import { FAMILY_LABELS, type ProjectMeta, type ProjectSource } from "@/lib/project-types";
import type { KnxMbmProject } from "@/gateway-families/knx-mbm/model";
import type { MeMbsProject } from "@/gateway-families/me-mbs/model";
import { NoProjectState } from "@/components/no-project";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";

const SOURCE_LABEL: Record<ProjectSource, string> = {
  demo: "Demo",
  file: "File",
  gateway: "Gateway",
};

function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function OverviewScreen() {
  const { view, loading, error, projectId, setProjectId, refresh } = useCurrentProject();
  const [projects, setProjects] = React.useState<ProjectMeta[]>([]);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [view]);

  async function run(action: () => Promise<ProjectMeta>) {
    setBusy(true);
    setActionError(null);
    try {
      const meta = await action();
      setProjectId(meta.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await run(() => openProjectFile(file));
  }

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

  const { meta, project, issues, hasCompleteBlob } = view;
  const activeSignals = project.signals.filter((s) => s.active).length;
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const infoCount = issues.filter((i) => i.severity === "info").length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Project
              <Badge variant={meta.source === "demo" ? "warning" : "muted"}>
                {SOURCE_LABEL[meta.source]}
              </Badge>
              <Badge variant="default">{FAMILY_LABELS[meta.family]}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="font-medium text-text-body">{meta.name}</div>
            {meta.description && <div className="text-fg-muted">{meta.description}</div>}
            <div className="text-xs text-fg-subtle">
              Last updated {formatUpdatedAt(meta.updatedAt)}
            </div>
            <div className="pt-1 text-xs">
              {hasCompleteBlob ? (
                <Badge variant="success">Gateway blob available for round-trip</Badge>
              ) : (
                <Badge variant="muted">No gateway blob — export is .ibmaps only</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contents</CardTitle>
          </CardHeader>
          <CardContent>
            {view.family === "me-mbs" ? (
              <MeMbsCounts project={view.project} activeSignals={activeSignals} />
            ) : (
              <KnxMbmCounts project={view.project} activeSignals={activeSignals} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Validation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-1.5">
              <Badge variant={errorCount > 0 ? "error" : "success"}>{errorCount} errors</Badge>
              <Badge variant={warningCount > 0 ? "warning" : "muted"}>{warningCount} warnings</Badge>
              {infoCount > 0 && <Badge variant="muted">{infoCount} info</Badge>}
            </div>
            <p className="text-xs text-fg-muted">
              Open the validation panel at the bottom-right for details.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(loadDemoProject)}>
              <FlaskConical className="h-3.5 w-3.5" aria-hidden />
              Load demo project
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <FileUp className="h-3.5 w-3.5" aria-hidden />
              Open .ibmaps file
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".ibmaps,.bin,application/xml,text/xml"
              className="hidden"
              aria-label="Open project file"
              onChange={handleFile}
            />
            <Button size="sm" variant="ghost" onClick={() => refresh()}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Refresh
            </Button>
            <a href={exportProjectUrl(meta.id)} className={buttonVariants({ variant: "secondary", size: "sm" })} download>
              <Download className="h-3.5 w-3.5" aria-hidden />
              Export project file
            </a>
          </div>
          {projects.length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <label htmlFor="project-switcher" className="text-fg-muted">
                Current project
              </label>
              <Select
                id="project-switcher"
                className="w-72"
                value={projectId ?? ""}
                onChange={(e) => setProjectId(e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({SOURCE_LABEL[p.source]})
                  </option>
                ))}
              </Select>
            </div>
          )}
          {actionError && (
            <p role="alert" className="text-sm text-error">
              {actionError}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CountRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="font-mono font-medium text-text-body">{value}</dd>
    </div>
  );
}

function KnxMbmCounts({
  project,
  activeSignals,
}: {
  project: KnxMbmProject;
  activeSignals: number;
}) {
  const deviceCount =
    project.mbm.rtuNodes.reduce((n, node) => n + node.devices.length, 0) +
    project.mbm.tcpNodes.reduce((n, node) => n + node.devices.length, 0);
  return (
    <dl className="space-y-1 text-sm">
      <CountRow label="Signals (active / total)" value={`${activeSignals} / ${project.signals.length}`} />
      <CountRow label="RTU nodes" value={String(project.mbm.rtuNodes.length)} />
      <CountRow label="TCP nodes" value={String(project.mbm.tcpNodes.length)} />
      <CountRow label="Modbus devices" value={String(deviceCount)} />
      <CountRow label="Conversions" value={String(project.conversions.length)} />
    </dl>
  );
}

function MeMbsCounts({
  project,
  activeSignals,
}: {
  project: MeMbsProject;
  activeSignals: number;
}) {
  const groups = project.me.controllers.flatMap((c) => c.groups);
  const enabledGroups = groups.filter((g) => g.enabled).length;
  return (
    <dl className="space-y-1 text-sm">
      <CountRow label="Signals (active / total)" value={`${activeSignals} / ${project.signals.length}`} />
      <CountRow label="Controllers" value={String(project.me.controllers.length)} />
      <CountRow label="Groups (enabled / total)" value={`${enabledGroups} / ${groups.length}`} />
      <CountRow label="Virtual slaves" value={String(project.mbs.slaves.length)} />
      <CountRow label="Conversions" value={String(project.conversions.length)} />
    </dl>
  );
}
