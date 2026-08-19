"use client";

import { DemoBanner } from "@/components/demo-banner";
import { Header } from "@/components/header";
import { Sidebar } from "@/components/sidebar";
import { ValidationPanel } from "@/components/validation-panel";
import { UndoToast } from "@/components/signals/undo-toast";
import { useWorkspaceChrome } from "@/lib/workspace-chrome";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const { sidebarCollapsed } = useWorkspaceChrome();

  return (
    <div className="h-screen overflow-hidden">
      <Sidebar />
      <div className={cn("flex h-full flex-col", sidebarCollapsed ? "ml-[56px]" : "ml-[228px]")}>
        <Header />
        <DemoBanner />
        <main className="flex min-h-0 w-full flex-1 flex-col overflow-auto p-6 pb-16">
          {children}
        </main>
      </div>
      <UndoToast />
      <ValidationPanel />
    </div>
  );
}
