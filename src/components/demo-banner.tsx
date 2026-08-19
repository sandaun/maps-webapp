"use client";

import { TriangleAlert } from "lucide-react";
import { useCurrentProject } from "@/lib/current-project";
import { useGatewaySession } from "@/lib/gateway-session";

export function DemoBanner() {
  const { view } = useCurrentProject();
  const { session, loading } = useGatewaySession();
  if (loading || session?.connected || view?.meta.source !== "demo") return null;

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-warning/30 bg-warning-bg px-6 py-1.5 text-xs text-warning-text"
    >
      <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
      <span>
        <strong>Demo mode</strong> — simulated project data. Not connected to a gateway.
      </span>
    </div>
  );
}
