"use client";

import * as React from "react";
import { ArrowLeftRight, Upload } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { sectionLabelForPath } from "@/lib/nav";
import { useCurrentProject } from "@/lib/current-project";
import type { FamilyId } from "@/lib/project-types";
import { useGatewaySession } from "@/lib/gateway-session";
import { useWorkspaceChrome } from "@/lib/workspace-chrome";
import { cn } from "@/lib/utils";

const PROTOCOL_LABELS: Record<FamilyId, readonly [string, string]> = {
  "knx-mbm": ["KNX TP", "MODBUS MASTER"],
  "me-mbs": ["MITSUBISHI ELECTRIC AC", "MODBUS SLAVE"],
};

function StatusChip({
  tone,
  dot = false,
  children,
}: {
  tone: "success" | "warning" | "error";
  dot?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-[7px] whitespace-nowrap rounded-[4px] border px-2.5 py-[5px] text-xs font-bold leading-none",
        tone === "success" && "border-success-border bg-success-bg text-success",
        tone === "warning" && "border-warning-border bg-warning-bg text-warning-text",
        tone === "error" && "border-error-border bg-error-bg text-error",
      )}
    >
      {dot ? (
        <span
          className={cn(
            "size-[7px] shrink-0 rounded-full",
            tone === "success" && "bg-[#008961] shadow-[0_0_0_3px_rgba(0,137,97,.15)]",
            tone === "warning" && "bg-warning shadow-[0_0_0_3px_rgba(212,150,32,.18)]",
            tone === "error" && "bg-error",
          )}
          aria-hidden
        />
      ) : null}
      {children}
    </span>
  );
}

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const section = sectionLabelForPath(pathname);
  const { view } = useCurrentProject();
  const { session, loading: sessionLoading } = useGatewaySession();
  const { dirtyCount } = useWorkspaceChrome();
  const projectsArea = pathname.startsWith("/projects");
  const breadcrumb =
    pathname === "/projects/new"
      ? ["Projects", "New project"]
      : projectsArea
        ? ["Local workspace", "Projects"]
        : ["MAPS Web", section];

  const errors = view?.issues.filter((i) => i.severity === "error").length ?? 0;
  const connected = session?.connected === true;
  const protocols = view ? PROTOCOL_LABELS[view.family] : null;

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-white px-5">
      <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
        <span className="font-display font-medium text-text-body">{breadcrumb[0]}</span>
        <span className="mx-2 text-fg-subtle">/</span>
        <span>{breadcrumb[1]}</span>
      </nav>

      {!projectsArea ? <div className="flex items-center gap-3.5">
        {protocols ? (
          <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-[4px] border border-border bg-[#F7F8F9] px-2.5 py-[5px]">
            <span className="font-mono text-[11px] font-semibold text-bms-text">{protocols[0]}</span>
            <ArrowLeftRight className="h-3.5 w-3.5 text-fg-subtle" strokeWidth={1.5} aria-hidden />
            <span className="font-mono text-[11px] font-semibold text-device-text">{protocols[1]}</span>
          </span>
        ) : null}
        <StatusChip tone={connected ? "success" : "warning"} dot>
          <span>{sessionLoading ? "Checking gateway…" : connected ? "Connected · Ethernet" : "Not connected"}</span>
          {connected ? (
            <span className="font-mono text-[11px] font-medium text-[#4E9179]">{session.host}</span>
          ) : null}
        </StatusChip>
        {view ? (
          errors > 0 ? (
            <StatusChip tone="error" dot>{errors} errors</StatusChip>
          ) : (
            <StatusChip tone="success" dot>Valid</StatusChip>
          )
        ) : null}
        <StatusChip tone={dirtyCount > 0 ? "warning" : "success"}>
          {dirtyCount > 0
            ? `${dirtyCount} change${dirtyCount === 1 ? "" : "s"} pending`
            : "Up to date"}
        </StatusChip>
        <Button
          className="h-[34px] rounded-[4px] px-[15px] text-[13px] font-bold"
          onClick={() => router.push("/deploy")}
        >
          <Upload className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          Deploy
        </Button>
      </div> : null}
    </header>
  );
}
