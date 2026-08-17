import { TriangleAlert } from "lucide-react";

export function DemoBanner() {
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
