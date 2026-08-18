"use client";

import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { sectionLabelForPath } from "@/lib/nav";
import { useCurrentProject } from "@/lib/current-project";

export function Header() {
  const pathname = usePathname();
  const section = sectionLabelForPath(pathname);
  const { view } = useCurrentProject();

  const errors = view?.issues.filter((i) => i.severity === "error").length ?? 0;
  const warnings = view?.issues.filter((i) => i.severity === "warning").length ?? 0;

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
            {errors > 0 ? (
              <Badge variant="error">{errors} errors</Badge>
            ) : (
              <Badge variant="success">No errors</Badge>
            )}
            {warnings > 0 && <Badge variant="warning">{warnings} warnings</Badge>}
          </>
        )}
        <Badge variant="muted">Offline</Badge>
        <Button size="sm" disabled title="Deployment is not available yet">
          Deploy
        </Button>
      </div>
    </header>
  );
}
