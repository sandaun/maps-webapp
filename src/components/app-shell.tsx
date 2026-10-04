"use client";

import { DemoBanner } from "@/components/demo-banner";
import { ModbusScanBanner } from "@/components/devices/modbus-scan-banner";
import { Header } from "@/components/header";
import { Sidebar } from "@/components/sidebar";
import { UndoPill } from "@/components/signals/undo-pill";
import { useWorkspaceChrome } from "@/lib/workspace-chrome";
import { cn } from "@/lib/utils";
import { bindGatewayProject } from "@/lib/gateway-api";
import { useCurrentProject } from "@/lib/current-project";
import { useGatewaySession } from "@/lib/gateway-session";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export function AppShell({ children }: { children: ReactNode }) {
  const { sidebarCollapsed } = useWorkspaceChrome();
  const { projectId, loading: projectLoading } = useCurrentProject();
  const { session } = useGatewaySession();
  const sessionId = session?.id;
  const bindingQueue = useRef<Promise<unknown>>(Promise.resolve());
  const pathname = usePathname();
  const projectsArea = pathname.startsWith("/projects");
  const settingsArea = pathname.startsWith("/settings");

  useEffect(() => {
    if (!sessionId || projectLoading) return;
    bindingQueue.current = bindingQueue.current
      .catch(() => undefined)
      .then(() => bindGatewayProject(sessionId, projectId))
      .catch(() => undefined);
  }, [sessionId, projectId, projectLoading]);

  return (
    <div className="h-screen overflow-hidden">
      <Sidebar />
      <div className={cn("flex h-full flex-col", sidebarCollapsed ? "ml-[56px]" : "ml-[228px]")}>
        <Header />
        {!projectsArea && !settingsArea && <DemoBanner />}
        <ModbusScanBanner />
        {/* tabIndex -1: focus target when transient UI (the save bar) closes under the user. */}
        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            "flex min-h-0 w-full flex-1 flex-col overflow-auto focus:outline-none",
            projectsArea ? "px-[22px] pt-[22px] pb-10" : "p-6",
          )}
        >
          {children}
        </main>
      </div>
      {!settingsArea && <UndoPill />}
    </div>
  );
}
