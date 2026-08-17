"use client";

import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { sectionLabelForPath } from "@/lib/nav";

export function Header() {
  const pathname = usePathname();
  const section = sectionLabelForPath(pathname);

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-white px-6">
      <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
        <span className="font-display font-medium text-text-body">MAPS Web</span>
        <span className="mx-2 text-fg-subtle">/</span>
        <span>{section}</span>
      </nav>

      <div className="flex items-center gap-2">
        <Badge variant="muted">Offline</Badge>
        <Badge variant="muted">—</Badge>
        <Button size="sm" disabled title="Deployment is not available yet">
          Deploy
        </Button>
      </div>
    </header>
  );
}
