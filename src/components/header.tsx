"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { sectionLabelForPath } from "@/lib/nav";
import { useCurrentProject } from "@/lib/current-project";
import { FAMILY_LABELS } from "@/lib/project-types";
import { listGatewaySessions, type GatewaySessionStatus } from "@/lib/gateway-api";
import { useWorkspaceChrome } from "@/lib/workspace-chrome";

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const section = sectionLabelForPath(pathname);
  const { view } = useCurrentProject();
  const { dirtyCount } = useWorkspaceChrome();
  const [session, setSession] = React.useState<GatewaySessionStatus | null | undefined>(undefined);

  React.useEffect(() => {
    let cancelled = false;
    listGatewaySessions()
      .then((sessions) => {
        if (cancelled) return;
        setSession(sessions.find((s) => s.connected) ?? null);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const errors = view?.issues.filter((i) => i.severity === "error").length ?? 0;
  const warnings = view?.issues.filter((i) => i.severity === "warning").length ?? 0;
  const connected = session?.connected === true;

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-white px-6">
      <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
        <span className="font-display font-medium text-text-body">MAPS Web</span>
        <span className="mx-2 text-fg-subtle">/</span>
        <span>{section}</span>
      </nav>

      <div className="flex items-center gap-2">
        {view && (
          <>
            <Badge variant="outline">{FAMILY_LABELS[view.family]}</Badge>
            {errors > 0 ? (
              <Badge variant="error">{errors} errors</Badge>
            ) : (
              <Badge variant="success">Valid</Badge>
            )}
            {warnings > 0 && <Badge variant="warning">{warnings} warnings</Badge>}
          </>
        )}
        <Badge variant={connected ? "success" : "muted"}>{connected ? `Connected · ${session.host}` : "Offline"}</Badge>
        {dirtyCount > 0 && (
          <Badge variant="warning">
            {dirtyCount} change{dirtyCount === 1 ? "" : "s"} pending
          </Badge>
        )}
        <Button size="sm" onClick={() => router.push("/deploy")}>
          Deploy
        </Button>
      </div>
    </header>
  );
}
