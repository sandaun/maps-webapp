"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, CircleDot, Wifi, WifiOff } from "lucide-react";
import { NAV_SECTIONS } from "@/lib/nav";
import { useCurrentProject } from "@/lib/current-project";
import { useGatewaySession } from "@/lib/gateway-session";
import { FAMILY_LABELS } from "@/lib/project-types";
import { useWorkspaceChrome } from "@/lib/workspace-chrome";
import { cn } from "@/lib/utils";

const PROJECT_SOURCE_LABELS = {
  gateway: "Gateway project",
  file: "Imported project",
  demo: "Demo project",
} as const;

export function Sidebar() {
  const pathname = usePathname();
  const { sidebarCollapsed, setSidebarCollapsed } = useWorkspaceChrome();
  const { view } = useCurrentProject();
  const { session, loading } = useGatewaySession();
  const connected = session?.connected === true;
  const gateway = session?.gateway;
  const gatewayTitle = gateway?.name ?? gateway?.appName ?? gateway?.platform ?? "Intesis gateway";
  const gatewayDetails = [...new Set([gateway?.appName, gateway?.platform])]
    .filter((value): value is string => !!value && value !== gatewayTitle);
  const gatewayIp = gateway?.ip ?? session?.host;

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 flex flex-col bg-hms-blue text-white transition-[width]",
        sidebarCollapsed ? "w-[56px]" : "w-[228px]",
      )}
    >
      <div className={cn("flex h-14 shrink-0 items-center border-b border-white/10 px-3", sidebarCollapsed && "justify-center")}>
        {sidebarCollapsed ? (
          <button
            type="button"
            className="group relative flex size-7 shrink-0 items-center justify-center rounded-sm bg-white text-hms-blue hover:bg-white/90"
            aria-label="Expand sidebar"
            title="Expand sidebar"
            onClick={() => setSidebarCollapsed(false)}
          >
            <CircleDot className="size-[17px]" strokeWidth={2} aria-hidden />
            <ChevronRight
              className="absolute -bottom-1 -right-1 size-3.5 rounded-full border border-white/20 bg-hms-blue p-0.5 text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              strokeWidth={2}
              aria-hidden
            />
          </button>
        ) : (
          <>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-white text-hms-blue" aria-hidden>
              <CircleDot className="size-[17px]" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1 pl-2.5">
              <div className="font-display text-[13px] font-semibold leading-4 tracking-[0.12em]">MAPS</div>
              <div className="font-display text-[8.5px] leading-3 tracking-[0.16em] text-white/55">INTESIS · CLOUD</div>
            </div>
            <button
              type="button"
              className="flex size-6 shrink-0 items-center justify-center rounded-sm text-white/55 hover:bg-white/10 hover:text-white"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              onClick={() => setSidebarCollapsed(true)}
            >
            <ChevronLeft className="size-3.5" strokeWidth={1.75} aria-hidden />
            </button>
          </>
        )}
      </div>

      {!sidebarCollapsed && (
        <div className="mx-3 my-3 rounded-md border border-white/10 bg-white/[.06] px-3 py-2.5" aria-label="Current workspace">
          <div className="text-[10px] uppercase tracking-[0.14em] text-white/45">Current project</div>
          <div className="mt-1 truncate text-[13px] font-semibold text-white/90">
            {view?.meta.name ?? "No project loaded"}
          </div>
          {view ? (
            <>
              <div className="mt-0.5 truncate text-[11px] text-white/60">{FAMILY_LABELS[view.family]}</div>
              <div className="mt-2 inline-flex rounded border border-white/10 bg-black/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/55">
                {PROJECT_SOURCE_LABELS[view.meta.source]}
              </div>
            </>
          ) : (
            <div className="mt-0.5 text-[11px] text-white/50">Open or receive a project</div>
          )}
        </div>
      )}

      {!sidebarCollapsed ? (
        <div className="px-5 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/35">Workspace</div>
      ) : null}

      <nav className="flex-1 space-y-0.5 px-2" aria-label="Workspace navigation">
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

      {sidebarCollapsed ? (
        <div
          className={cn(
            "mx-2 mb-3 flex size-10 items-center justify-center rounded border border-white/10 bg-white/[.06]",
            connected ? "text-[#43D3A8]" : "text-white/35",
          )}
          title={loading ? "Checking gateway…" : connected ? `Connected to ${gatewayIp}` : "No gateway connected"}
        >
          {connected ? <Wifi className="h-4 w-4" aria-hidden /> : <WifiOff className="h-4 w-4" aria-hidden />}
        </div>
      ) : (
        <div className="mx-3 mb-3 rounded-md border border-white/10 bg-white/[.06] px-3 py-2.5" aria-label="Gateway status">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "size-1.5 rounded-full",
                connected ? "bg-[#43D3A8] shadow-[0_0_0_3px_rgba(67,211,168,.12)]" : loading ? "bg-warning" : "bg-white/30",
              )}
              aria-hidden
            />
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/60">
              {loading ? "Checking gateway" : connected ? "Gateway connected" : "Gateway offline"}
            </span>
          </div>

          {loading ? (
            <div className="mt-2 text-[11px] text-white/50">Reading live session…</div>
          ) : connected ? (
            <>
              <div className="mt-2 truncate text-[13px] font-semibold text-white/90">{gatewayTitle}</div>
              {gatewayDetails.length > 0 ? (
                <div className="mt-0.5 truncate text-[10px] text-white/55">{gatewayDetails.join(" · ")}</div>
              ) : null}
              <dl className="mt-2 grid grid-cols-[34px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[10px]">
                <dt className="text-white/35">IP</dt>
                <dd className="truncate font-mono text-white/70">{gatewayIp}</dd>
                {gateway?.appVersion ? (
                  <>
                    <dt className="text-white/35">App</dt>
                    <dd className="truncate font-mono text-white/70">{gateway.appVersion}</dd>
                  </>
                ) : null}
                {gateway?.serial ? (
                  <>
                    <dt className="text-white/35">S/N</dt>
                    <dd className="truncate font-mono text-white/70">{gateway.serial}</dd>
                  </>
                ) : null}
              </dl>
            </>
          ) : (
            <>
              <div className="mt-2 text-[12px] font-medium text-white/75">No gateway connected</div>
              <div className="mt-0.5 text-[10px] leading-4 text-white/45">
                {view?.meta.source === "demo"
                  ? "Demo project · local data only"
                  : view
                    ? "Project open · connect to work live"
                    : "Connect a gateway to start"}
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
