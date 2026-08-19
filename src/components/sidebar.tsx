"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NAV_SECTIONS } from "@/lib/nav";
import { useGatewaySession } from "@/lib/gateway-session";
import { useWorkspaceChrome } from "@/lib/workspace-chrome";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const pathname = usePathname();
  const { sidebarCollapsed, setSidebarCollapsed } = useWorkspaceChrome();
  const { session, loading } = useGatewaySession();
  const connected = session?.connected === true;

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 flex flex-col bg-hms-blue text-white transition-[width]",
        sidebarCollapsed ? "w-[56px]" : "w-[228px]",
      )}
    >
      <div className={cn("flex h-14 shrink-0 items-center border-b border-white/10 px-2", sidebarCollapsed && "justify-center")}>
        <button
          type="button"
          className="flex size-10 shrink-0 items-center justify-center rounded text-white/65 hover:bg-white/10 hover:text-white"
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden />
          ) : (
            <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden />
          )}
        </button>
        {!sidebarCollapsed ? (
          <div className="min-w-0 pl-1.5">
            <div className="font-display text-lg font-medium leading-5 tracking-wide">MAPS</div>
            <div className="font-display text-[10px] tracking-[0.18em] text-white/60">· INTESIS CLOUD</div>
          </div>
        ) : null}
      </div>

      {!sidebarCollapsed && (
        <div className="mx-3 my-3 rounded-md bg-white/5 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-white/50">Gateway</div>
          <div className="mt-1 flex items-center gap-2 text-xs text-white/80">
            <span
              className={cn(
                "size-1.5 rounded-full",
                connected ? "bg-[#28C498]" : loading ? "bg-warning" : "bg-white/30",
              )}
              aria-hidden
            />
            <span className="truncate">
              {loading ? "Checking connection…" : connected ? session.host : "No gateway connected"}
            </span>
          </div>
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
        <div className="mx-3 mb-3 rounded-md bg-white/5 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-white/50">Session</div>
          <div className="mt-1 text-xs font-medium text-white/80">
            {loading ? "Checking…" : connected ? `Live · ${session.encrypted ? "encrypted" : "cleartext"}` : "No active session"}
          </div>
        </div>
      )}
    </aside>
  );
}
