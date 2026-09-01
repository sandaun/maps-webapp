"use client";

import * as React from "react";
import Link from "next/link";
import { listProjectHistory, type ProjectHistoryEntry } from "@/lib/api";
import { useCurrentProject } from "@/lib/current-project";
import { useGatewaySession } from "@/lib/gateway-session";
import { FAMILY_LABELS, type ProjectSource } from "@/lib/project-types";
import { signalsHref } from "@/lib/signals-tabs";
import { formatPhysicalAddress } from "@/protocols/knx/address";
import { cn } from "@/lib/utils";
import { NoProjectState } from "@/components/no-project";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const SOURCE_LABEL: Record<ProjectSource, string> = {
  demo: "Demo",
  file: "File",
  gateway: "Gateway",
  template: "Template",
};

function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function OverviewScreen() {
  const { view, loading, error } = useCurrentProject();
  const { session } = useGatewaySession();

  const projectId = view?.meta.id ?? null;
  const [historyState, setHistoryState] = React.useState<{
    id: string | null;
    entries: ProjectHistoryEntry[];
  }>({ id: null, entries: [] });
  React.useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    listProjectHistory(projectId)
      .then((entries) => {
        if (!cancelled) setHistoryState({ id: projectId, entries });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  const history = historyState.id === projectId ? historyState.entries : [];

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

  const { meta, project, issues } = view;
  const activeSignals = project.signals.filter((s) => s.active).length;
  const disabledCount = project.signals.length - activeSignals;
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const topIssue =
    issues.find((i) => i.severity === "error") ?? issues.find((i) => i.severity === "warning");
  const firstWarning = issues.find((i) => i.severity === "warning");
  const signalsPct =
    project.signals.length === 0
      ? 0
      : Math.min(100, Math.round((activeSignals / project.signals.length) * 100));
  const connected = session?.connected ?? false;

  return (
    <div className="max-w-[1500px]">
      {/* ---------- Stat cards ---------- */}
      <div className="mb-[14px] grid grid-cols-1 gap-[14px] sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Signals exposed to BMS">
          <BigNumber
            value={String(activeSignals)}
            sub={`of ${project.signals.length} · ${disabledCount} disabled`}
          />
          <div className="mt-[11px] h-[5px] overflow-hidden rounded-full bg-hms-muted">
            <div className="h-full bg-hms-accent" style={{ width: `${signalsPct}%` }} />
          </div>
          <CardLink href={signalsHref("map")}>Open signal map →</CardLink>
        </StatCard>

        {view.family === "knx-mbm" ? (
          <KnxMbmDeviceCard project={view.project} conversions={view.project.conversions.length} />
        ) : (
          <MeMbsGroupCard project={view.project} />
        )}

        {view.family === "knx-mbm" ? (
          <StatCard label="KNX interface">
            <BigNumber
              value={formatPhysicalAddress(view.project.knx.physicalAddress)}
              sub="physical address"
            />
            <p className="mt-[11px] text-[11.5px] text-fg-muted">
              {view.project.knx.extendedAddresses
                ? "Extended group addresses"
                : "Standard group addresses"}
            </p>
          </StatCard>
        ) : (
          <StatCard label="Controller polling">
            <BigNumber value={String(view.project.me.pollPeriod)} sub="ms poll period" />
            <p className="mt-[11px] text-[11.5px] text-fg-muted">
              Answer timeout {view.project.me.ansTimeout} ms
            </p>
          </StatCard>
        )}

        <Card
          className={cn(
            "px-4 py-[15px]",
            errorCount + warningCount > 0 ? "border-warning-border" : "border-success-border",
          )}
        >
          <div
            className={cn(
              "mb-[9px] text-[11.5px]",
              errorCount + warningCount > 0 ? "text-warning-text" : "text-success",
            )}
          >
            Attention
          </div>
          <BigNumber
            value={String(errorCount)}
            sub={`errors · ${warningCount} warnings`}
            tone={errorCount > 0 ? "error" : "success"}
          />
          <div
            className={cn(
              "mt-[11px] rounded border px-2.5 py-2 text-[11.5px] leading-[1.4]",
              topIssue
                ? "border-warning-border bg-warning-bg text-warning-text"
                : "border-success-border bg-success-bg text-success",
            )}
          >
            {topIssue ? topIssue.message : "No open issues — the project passes all validation rules."}
          </div>
          <CardLink href={signalsHref("validation")}>Review validation →</CardLink>
        </Card>
      </div>

      {/* ---------- Translation path + right rail ---------- */}
      <div className="grid gap-[14px] lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Card className="px-[18px] pb-[18px] pt-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-[15px] font-light text-hms-blue">Translation path</h2>
            <span className="font-mono text-[11px] text-fg-subtle">
              {FAMILY_LABELS[meta.family]} · {SOURCE_LABEL[meta.source]}
            </span>
          </div>

          <div className="flex items-stretch overflow-x-auto">
            {view.family === "knx-mbm" ? (
              <SideBox
                side="bms"
                label="BMS side"
                titleA="KNX TP"
                titleB="interface"
                metaA={`Phys. addr ${formatPhysicalAddress(view.project.knx.physicalAddress)}`}
                metaB={`${project.signals.length} group addresses linked`}
              />
            ) : (
              <SideBox
                side="bms"
                label="BMS side"
                titleA="Modbus"
                titleB="server"
                metaA={`${view.project.mbs.slaves.length} virtual slaves`}
                metaB={`${project.signals.length} registers exposed`}
              />
            )}

            <PathLink label={`${activeSignals} signals`} from="bms" />

            <div className="w-[186px] shrink-0 bg-hms-blue p-[13px] text-white">
              <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[.09em] text-hms-pop">
                Gateway
              </div>
              <div className="text-[14px] font-bold leading-[1.3]">
                {project.gateway.name || "Intesis gateway"}
              </div>
              <div className="mt-2 text-[11.5px] leading-[1.6] text-white/70">
                {project.gateway.ip || "—"} · {project.gateway.dhcp ? "DHCP" : "static"}
                <br />
                {connected && session?.gateway
                  ? [session.gateway.serial && `S/N ${session.gateway.serial}`, session.gateway.appVersion]
                      .filter(Boolean)
                      .join(" · ")
                  : "No active session"}
              </div>
              <div className="mt-2.5 flex items-center gap-1.5 text-[11.5px]">
                <span
                  className={cn("size-1.5 rounded-full", connected ? "bg-live" : "bg-white/40")}
                />
                {connected ? "connected" : "not connected"}
              </div>
            </div>

            <PathLink
              label={
                view.family === "knx-mbm"
                  ? `${countMbmDevices(view.project)} devices`
                  : `${countMeGroups(view.project).total} groups`
              }
              from="gateway"
            />

            {view.family === "knx-mbm" ? (
              <SideBox
                side="device"
                label="Device side"
                titleA="Modbus"
                titleB="master"
                metaA={`${countMbmDevices(view.project)} devices`}
                metaB={`${view.project.mbm.rtuNodes.length} RTU · ${view.project.mbm.tcpNodes.length} TCP nodes`}
                href="/devices"
                linkLabel="Device list →"
              />
            ) : (
              <SideBox
                side="device"
                label="Device side"
                titleA="Mitsubishi Electric"
                titleB="AC"
                metaA={`${view.project.me.controllers.length} controllers`}
                metaB={`${countMeGroups(view.project).enabled} of ${countMeGroups(view.project).total} groups enabled`}
                href="/devices"
                linkLabel="AC unit list →"
              />
            )}
          </div>

          <div className="mt-[18px] grid grid-cols-2 gap-[14px] border-t border-border pt-4 sm:grid-cols-4">
            <MiniStat label="Gateway IP" value={project.gateway.ip || "—"} />
            <MiniStat label="Source" value={SOURCE_LABEL[meta.source]} />
            <MiniStat label="Conversions" value={String(project.conversions.length)} />
            <MiniStat label="Last updated" value={formatUpdatedAt(meta.updatedAt)} />
          </div>
        </Card>

        <div className="flex flex-col gap-[14px]">
          <NextSteps
            errorCount={errorCount}
            warningCount={warningCount}
            topIssueMessage={topIssue?.message}
            firstWarningMessage={firstWarning?.message}
            connected={connected}
          />

          <Card className="flex-1 px-4 py-[15px]">
            <div className="mb-[11px] flex items-center justify-between">
              <h2 className="font-display text-[15px] font-light text-hms-blue">Activity</h2>
              <Link
                href={signalsHref("import")}
                className="text-[11.5px] text-hms-accent hover:underline"
              >
                Audit trail
              </Link>
            </div>
            {history.length === 0 ? (
              <p className="text-[11.5px] leading-[1.6] text-fg-muted">
                No history yet — edits and deploys will appear here.
              </p>
            ) : (
              history.slice(0, 6).map((entry) => (
                <div key={entry.id} className="flex gap-[9px] py-[7px]">
                  <span
                    className={cn(
                      "mt-[5px] size-[7px] shrink-0 rounded-full",
                      entry.tag === "draft" ? "bg-warning" : "bg-success",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs leading-[1.4] text-text-body">{entry.text}</span>
                    <span className="block font-mono text-[10.5px] text-fg-subtle">
                      {formatUpdatedAt(entry.at)} · {entry.who} · {entry.tag}
                    </span>
                  </span>
                </div>
              ))
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ---------- building blocks ---------- */

function StatCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card className="px-4 py-[15px]">
      <div className="mb-[9px] text-[11.5px] text-fg-muted">{label}</div>
      {children}
    </Card>
  );
}

function BigNumber({
  value,
  sub,
  tone,
}: {
  value: string;
  sub?: string;
  tone?: "error" | "success";
}) {
  return (
    <div className="flex items-baseline gap-[5px]">
      <span
        className={cn(
          "font-display text-[30px] font-light leading-none",
          tone === "error" ? "text-error" : tone === "success" ? "text-success" : "text-hms-blue",
        )}
      >
        {value}
      </span>
      {sub ? <span className="text-[13px] text-fg-subtle">{sub}</span> : null}
    </div>
  );
}

function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="mt-[9px] block text-[11.5px] font-bold text-hms-accent hover:underline"
    >
      {children}
    </Link>
  );
}

function SideBox({
  side,
  label,
  titleA,
  titleB,
  metaA,
  metaB,
  href,
  linkLabel,
}: {
  side: "bms" | "device";
  label: string;
  titleA: string;
  titleB: string;
  metaA: string;
  metaB: string;
  href?: string;
  linkLabel?: string;
}) {
  const bms = side === "bms";
  return (
    <div
      className={cn(
        "w-[180px] shrink-0 rounded-[6px] border p-[13px]",
        bms ? "border-bms-border bg-bms-surface" : "border-device-border bg-device-surface",
      )}
    >
      <div
        className={cn(
          "mb-2 font-mono text-[10px] font-semibold uppercase tracking-[.09em]",
          bms ? "text-bms-text" : "text-device-text",
        )}
      >
        {label}
      </div>
      <div className="text-[14px] font-bold leading-[1.3] text-hms-blue">
        {titleA}
        <br />
        {titleB}
      </div>
      <div className="mt-2 text-[11.5px] leading-[1.6] text-fg-muted">
        {metaA}
        <br />
        {metaB}
      </div>
      {href && linkLabel ? (
        <Link
          href={href}
          className="mt-2.5 block text-[11.5px] font-bold text-hms-accent hover:underline"
        >
          {linkLabel}
        </Link>
      ) : null}
    </div>
  );
}

/** Connector between the translation-path boxes. */
function PathLink({ label, from }: { label: string; from: "bms" | "gateway" }) {
  return (
    <div className="flex min-w-[60px] flex-1 flex-col items-center justify-center px-1">
      <div className="mb-1 font-mono text-[10.5px] text-fg-subtle">{label}</div>
      <div
        className={cn(
          "h-0.5 w-full",
          from === "bms"
            ? "bg-gradient-to-r from-bms-border to-hms-accent"
            : "bg-gradient-to-r from-hms-accent to-info-border",
        )}
      />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-[3px] text-[11px] text-fg-muted">{label}</div>
      <div className="font-mono text-[12.5px] text-hms-blue">{value}</div>
    </div>
  );
}

/* ---------- next steps ---------- */

interface Step {
  title: string;
  sub: string;
  tag: "open" | "blocked" | "done" | "";
  href: string;
}

function NextSteps({
  errorCount,
  warningCount,
  topIssueMessage,
  firstWarningMessage,
  connected,
}: {
  errorCount: number;
  warningCount: number;
  topIssueMessage?: string;
  firstWarningMessage?: string;
  connected: boolean;
}) {
  const steps: Step[] = [];
  if (errorCount > 0) {
    steps.push({
      title: `Resolve ${errorCount} validation ${errorCount === 1 ? "error" : "errors"}`,
      sub: topIssueMessage ?? "",
      tag: "open",
      href: signalsHref("validation"),
    });
  }
  if (warningCount > 0) {
    steps.push({
      title: `Review ${warningCount} ${warningCount === 1 ? "warning" : "warnings"}`,
      sub: firstWarningMessage ?? "",
      tag: "open",
      href: signalsHref("validation"),
    });
  }
  if (errorCount === 0 && warningCount === 0) {
    steps.push({
      title: "Validation is clean",
      sub: "No errors or warnings in the signal table.",
      tag: "done",
      href: signalsHref("validation"),
    });
  }
  steps.push({
    title: "Send configuration",
    sub: connected
      ? "Deploy the current project to the connected gateway."
      : "Connect a gateway from the Connection tab before deploying.",
    tag: connected ? "open" : "blocked",
    href: "/deploy",
  });
  steps.push({
    title: "Verify in diagnostics",
    sub: "Check live traffic and values after deploying.",
    tag: "",
    href: "/diagnostics",
  });

  return (
    <Card className="px-4 py-[15px]">
      <h2 className="mb-3 font-display text-[15px] font-light text-hms-blue">Next steps</h2>
      {steps.slice(0, 4).map((step, index) => {
        const done = step.tag === "done";
        return (
          <Link
            key={step.title}
            href={step.href}
            className="flex items-start gap-2.5 border-t border-border py-[9px] hover:bg-table-header"
          >
            <span
              className={cn(
                "flex size-[19px] shrink-0 items-center justify-center rounded-full font-mono text-[10.5px] font-semibold",
                done ? "bg-success text-white" : "bg-info-bg text-hms-accent",
              )}
            >
              {done ? "✓" : index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-bold text-hms-blue">{step.title}</span>
              <span className="block text-[11.5px] leading-[1.45] text-fg-muted">{step.sub}</span>
            </span>
            {step.tag ? (
              <Badge
                variant={
                  step.tag === "done" ? "success" : step.tag === "blocked" ? "error" : "warning"
                }
                className={cn(
                  step.tag === "done" && "border-success-border",
                  step.tag === "blocked" && "border-error-border",
                  step.tag === "open" && "border-warning-border",
                )}
              >
                {step.tag}
              </Badge>
            ) : null}
          </Link>
        );
      })}
    </Card>
  );
}

/* ---------- per-family helpers ---------- */

function countMbmDevices(project: {
  mbm: { rtuNodes: { devices: unknown[] }[]; tcpNodes: { devices: unknown[] }[] };
}): number {
  return (
    project.mbm.rtuNodes.reduce((n, node) => n + node.devices.length, 0) +
    project.mbm.tcpNodes.reduce((n, node) => n + node.devices.length, 0)
  );
}

function countMeGroups(project: {
  me: { controllers: { groups: { enabled: boolean }[] }[] };
}): { enabled: number; total: number } {
  const groups = project.me.controllers.flatMap((c) => c.groups);
  return { enabled: groups.filter((g) => g.enabled).length, total: groups.length };
}

function KnxMbmDeviceCard({
  project,
  conversions,
}: {
  project: Parameters<typeof countMbmDevices>[0];
  conversions: number;
}) {
  return (
    <StatCard label="Modbus devices">
      <BigNumber
        value={String(countMbmDevices(project))}
        sub={`${project.mbm.rtuNodes.length} RTU · ${project.mbm.tcpNodes.length} TCP nodes`}
      />
      <p className="mt-[11px] text-[11.5px] text-fg-muted">{conversions} conversions defined</p>
      <CardLink href="/devices">Open devices →</CardLink>
    </StatCard>
  );
}

function MeMbsGroupCard({
  project,
}: {
  project: Parameters<typeof countMeGroups>[0] & { mbs: { slaves: unknown[] } };
}) {
  const groups = countMeGroups(project);
  return (
    <StatCard label="AC groups">
      <BigNumber value={String(groups.enabled)} sub={`of ${groups.total} enabled`} />
      <p className="mt-[11px] text-[11.5px] text-fg-muted">
        {project.mbs.slaves.length} virtual slaves
      </p>
      <CardLink href="/devices">Open devices →</CardLink>
    </StatCard>
  );
}
