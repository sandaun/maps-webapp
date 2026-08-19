"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeftRight, ChevronRight, FileUp, RadioTower } from "lucide-react";
import { useRouter } from "next/navigation";
import { getProjectView, listProjects, openProjectFile } from "@/lib/api";
import { receiveGatewayProject } from "@/lib/gateway-api";
import { useCurrentProject } from "@/lib/current-project";
import { useGatewaySession } from "@/lib/gateway-session";
import type { FamilyId, ProjectMeta, ProjectView } from "@/lib/project-types";
import { useWorkspaceChrome } from "@/lib/workspace-chrome";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PROTOCOLS: Record<FamilyId, readonly [string, string]> = {
  "knx-mbm": ["KNX", "Modbus Master"],
  "me-mbs": ["Mitsubishi Electric", "Modbus Server"],
};

function signalCount(view: ProjectView): number {
  return view.project.signals.length;
}

function relativeTime(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

export function ProjectsScreen() {
  const router = useRouter();
  const { projectId, setProjectId } = useCurrentProject();
  const { session } = useGatewaySession();
  const { dirtyCount } = useWorkspaceChrome();
  const [projects, setProjects] = React.useState<ProjectMeta[]>([]);
  const [views, setViews] = React.useState<Record<string, ProjectView>>({});
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    let cancelled = false;
    listProjects()
      .then(async (metas) => {
        if (cancelled) return;
        setProjects(metas);
        const entries = await Promise.all(
          metas.map(async (meta) => {
            try {
              return [meta.id, await getProjectView(meta.id)] as const;
            } catch {
              return null;
            }
          }),
        );
        if (!cancelled) {
          setViews(Object.fromEntries(entries.filter((entry) => entry !== null)));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load projects");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function openProject(id: string) {
    setProjectId(id);
    router.push("/overview");
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const project = await openProjectFile(file);
      openProject(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import project");
    } finally {
      setBusy(false);
    }
  }

  async function handleReceive() {
    if (!session) {
      router.push("/connection");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const project = await receiveGatewayProject(session.id);
      openProject(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to receive project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-[1240px]">
      <div className="mb-[18px] flex items-end justify-between gap-[14px]">
        <div>
          <h1 className="font-display text-[26px] font-light leading-8 text-hms-blue">Projects</h1>
          <p className="mt-0.5 text-[12.5px] text-fg-muted">
            {projects.length} {projects.length === 1 ? "project" : "projects"} · local workspace
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            className="h-9 rounded-[4px] px-4 text-[13px] font-medium"
            onClick={() => router.push("/projects/new")}
          >
            New project
          </Button>
          <Button
            variant="secondary"
            className="h-9 rounded-[4px] px-4 text-[13px] font-medium"
            disabled={busy}
            onClick={handleReceive}
          >
            Receive from gateway
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mb-3 rounded border border-error-border bg-error-bg px-3 py-2 text-xs text-error">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-[14px]">
        <section className="min-w-0 overflow-hidden rounded-[6px] border border-border bg-white">
          <div className="grid grid-cols-[minmax(230px,1.45fr)_minmax(155px,.9fr)_92px_112px_80px] border-b border-border bg-table-header px-4 py-2 font-mono text-[10.5px] font-semibold uppercase tracking-[.06em] text-fg-muted">
            <span>Project / gateway</span>
            <span>Protocols</span>
            <span>Signals</span>
            <span>State</span>
            <span>Updated</span>
          </div>

          {loading ? (
            <p className="px-4 py-8 text-center text-xs text-fg-muted">Loading projects…</p>
          ) : projects.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="font-display text-base text-text-body">No projects yet</p>
              <p className="mt-1 text-xs text-fg-muted">Start from a template, a file, or a gateway.</p>
            </div>
          ) : (
            <div>
              {projects.map((project) => {
                const view = views[project.id];
                const protocols = PROTOCOLS[project.family];
                const active = project.id === projectId;
                const localChanges = project.source !== "gateway" || (active && dirtyCount > 0);
                return (
                  <button
                    key={project.id}
                    type="button"
                    className={cn(
                      "grid w-full grid-cols-[minmax(230px,1.45fr)_minmax(155px,.9fr)_92px_112px_80px] items-center border-b border-row-rule px-4 py-3 text-left last:border-b-0 hover:bg-row-hover",
                      active && "bg-row-selected",
                    )}
                    onClick={() => openProject(project.id)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-[#244f68]">
                        {project.name}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-fg-subtle">
                        {project.fileName ?? project.id}
                      </span>
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-fg-muted">
                      <span className="truncate">{protocols[0]}</span>
                      <ArrowLeftRight className="size-3 shrink-0 text-fg-subtle" strokeWidth={1.5} />
                      <span className="truncate">{protocols[1]}</span>
                    </span>
                    <span className="font-mono text-[11.5px] text-fg-muted">
                      {view ? `${signalCount(view)} signals` : "—"}
                    </span>
                    <span>
                      <span
                        className={cn(
                          "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
                          localChanges
                            ? "border-warning-border bg-warning-bg text-warning-text"
                            : "border-success-border bg-success-bg text-success",
                        )}
                      >
                        {localChanges ? "local changes" : "deployed"}
                      </span>
                    </span>
                    <span className="text-[11.5px] text-fg-subtle">{relativeTime(project.updatedAt)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded-[6px] border border-border bg-white p-4">
            <h2 className="font-display text-[15px] font-medium text-hms-blue">Start from</h2>
            <div className="mt-2 divide-y divide-border">
              <Link
                href="/projects/new"
                className="flex items-center gap-2 py-2 text-[12.5px] text-text-body hover:text-hms-accent"
              >
                <span className="rounded bg-[#EDF3F7] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-hms-blue">TPL</span>
                <span className="min-w-0 flex-1">Create from a template</span>
                <ChevronRight className="size-3.5 text-hms-accent" />
              </Link>
              <button
                type="button"
                className="flex w-full items-center gap-2 py-2 text-left text-[12.5px] text-text-body hover:text-hms-accent"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                <FileUp className="size-3.5 text-fg-subtle" />
                <span className="min-w-0 flex-1">Import an existing .ibmaps project</span>
                <ChevronRight className="size-3.5 text-hms-accent" />
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 py-2 text-left text-[12.5px] text-text-body hover:text-hms-accent"
                onClick={handleReceive}
                disabled={busy}
              >
                <RadioTower className="size-3.5 text-fg-subtle" />
                <span className="min-w-0 flex-1">Receive configuration from a gateway</span>
                <ChevronRight className="size-3.5 text-hms-accent" />
              </button>
            </div>
          </section>

          <section className="rounded-[6px] border border-border bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-[15px] font-medium text-hms-blue">Access</h2>
              <span className="text-[11.5px] text-hms-accent">Manage</span>
            </div>
            <div className="mt-3 flex items-center gap-2.5">
              <span className="flex size-[26px] items-center justify-center rounded-full bg-[#496777] text-[10.5px] font-semibold text-white">LU</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium">Local user</span>
                <span className="block text-[11px] text-fg-muted">This device</span>
              </span>
              <span className="rounded-full bg-[#EDF3F7] px-2 py-0.5 text-[11px] font-medium text-[#617684]">Admin</span>
            </div>
          </section>
        </aside>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".ibmaps,.bin,application/xml,text/xml"
        className="hidden"
        aria-label="Import project file"
        onChange={handleFile}
      />
    </div>
  );
}
