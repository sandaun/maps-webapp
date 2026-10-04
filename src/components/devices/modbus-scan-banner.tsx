"use client";
import * as React from "react";
import { request } from "@/lib/api";
import { isScanTerminal, type ScanJob } from "@/core/modbus-scan/model";
import { Button } from "@/components/ui/button";
import { ModbusScanModal } from "./modbus-scan-modal";

/** Recovery stays visible when the user changes project or navigates away. */
export function ModbusScanBanner() {
  const [jobs, setJobs] = React.useState<ScanJob[]>([]); const [open, setOpen] = React.useState<ScanJob | null>(null);
  React.useEffect(() => {
    let disposed = false;
    const refresh = () => { void request<{ jobs: ScanJob[] }>("/api/modbus-scans").then(({ jobs: next }) => { if (!disposed) setJobs(next.filter((job) => !isScanTerminal(job.state) || job.needsRestore)); }).catch(() => {}); };
    refresh(); const timer = window.setInterval(refresh, 3000); return () => { disposed = true; window.clearInterval(timer); };
  }, []);
  return <>{jobs.map((job) => <div key={job.id} role="status" className="flex items-center gap-3 border-b border-border bg-card-foot px-6 py-2 text-sm"><p className="flex-1">Modbus scan · {job.host} · {job.state === "restore-pending" ? "Backup restoration pending. Gateway deployments are blocked." : job.state === "restoring" ? "Restoring the original gateway project…" : `${job.processed}/${job.points} points observed`}</p><Button size="sm" variant="secondary" onClick={() => setOpen(job)}>{job.state === "restore-pending" ? "Restore backup" : "View scan"}</Button></div>)}{open && <ModbusScanModal initialLocator={open.input.locator} initialJobId={open.id} onClose={() => setOpen(null)} />}</>;
}
