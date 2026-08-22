"use client";

import { DemoBanner } from "@/components/demo-banner";
import { Header } from "@/components/header";
import { Sidebar } from "@/components/sidebar";
import { ValidationPanel } from "@/components/validation-panel";
import { UndoToast } from "@/components/signals/undo-toast";
import { useWorkspaceChrome } from "@/lib/workspace-chrome";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

export function AppShell({ children }: { children: ReactNode }) {
  const { sidebarCollapsed } = useWorkspaceChrome();
  const pathname = usePathname();
  const projectsArea = pathname.startsWith("/projects");

  return (
    <div className="h-screen overflow-hidden">
      <Sidebar />
      <div className={cn("flex h-full flex-col", sidebarCollapsed ? "ml-[56px]" : "ml-[228px]")}>
        <Header />
        {!projectsArea && <DemoBanner />}
        <main
          className={cn(
            "flex min-h-0 w-full flex-1 flex-col overflow-auto pb-16",
            projectsArea ? "px-[22px] pt-[22px] pb-10" : "p-6",
          )}
        >
          {children}
        </main>
      </div>
      <UndoToast />
      <ValidationPanel />
    </div>
  );
}
