"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { NAV_SECTIONS } from "@/lib/nav";
import { useWorkspaceChrome } from "@/lib/workspace-chrome";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const pathname = usePathname();
  const { sidebarCollapsed, setSidebarCollapsed } = useWorkspaceChrome();

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 flex flex-col bg-hms-blue text-white transition-[width]",
        sidebarCollapsed ? "w-[56px]" : "w-[228px]",
      )}
    >
      <div className={cn("px-4 pt-5 pb-4", sidebarCollapsed && "px-2 text-center")}>
        <div className="font-display text-lg font-medium tracking-wide">MAPS</div>
        {!sidebarCollapsed && (
          <div className="font-display text-[10px] tracking-[0.18em] text-white/60">· INTESIS CLOUD</div>
        )}
      </div>

      {!sidebarCollapsed && (
        <div className="mx-3 mb-3 rounded-md bg-white/5 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-white/50">Gateway</div>
          <div className="mt-0.5 text-xs text-white/80">No gateway connected</div>
        </div>
      )}

      <nav className="flex-1 space-y-0.5 px-2" aria-label="Main">
        {NAV_SECTIONS.map((section) => {
          const active = pathname.startsWith(section.href);
          const Icon = section.icon;
          return (
            <Link
              key={section.href}
              href={section.href}
              aria-label={section.label}
              title={sidebarCollapsed ? section.label : undefined}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-2.5 rounded-r px-3 py-2 text-[13px] transition-colors",
                sidebarCollapsed && "justify-center px-2",
                active
                  ? "bg-white/10 font-medium text-white before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-hms-pop"
                  : "text-white/70 hover:bg-white/5 hover:text-white",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {!sidebarCollapsed && section.label}
            </Link>
          );
        })}
      </nav>

      {!sidebarCollapsed && (
        <div className="mx-3 mb-2 rounded-md bg-white/5 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-white/50">Session</div>
          <Badge variant="warning" className="mt-1">
            Demo mode
          </Badge>
        </div>
      )}

      <button
        type="button"
        className="mb-3 mx-2 flex items-center justify-center gap-2 rounded px-2 py-2 text-white/70 hover:bg-white/10 hover:text-white"
        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
      >
        {sidebarCollapsed ? (
          <ChevronRight className="h-4 w-4" aria-hidden />
        ) : (
          <>
            <ChevronLeft className="h-4 w-4" aria-hidden />
            <span className="text-[12px]">Collapse</span>
          </>
        )}
      </button>
    </aside>
  );
}
