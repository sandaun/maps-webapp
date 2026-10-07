"use client";

import * as React from "react";
import { diagnosticDownloadUrl, listDiagnosticLogs } from "@/lib/gateway-api";
import type { DiagnosticArchiveInfo } from "@/lib/diagnostics-history";
import { Modal } from "@/components/ui/modal";

export function SavedDiagnosticLogs() {
  const [open, setOpen] = React.useState(false);
  const [archives, setArchives] = React.useState<DiagnosticArchiveInfo[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!open) return;
    let disposed = false;
    listDiagnosticLogs().then((items) => { if (!disposed) { setArchives(items); setError(null); } })
      .catch(() => { if (!disposed) setError("Could not load saved captures."); });
    return () => { disposed = true; };
  }, [open]);
  return <>
    <button type="button" onClick={() => setOpen(true)} className="cursor-pointer rounded-[4px] border border-border px-[11px] py-[7px] text-[12.5px] font-bold text-hms-blue">Saved logs</button>
    {open && <Modal onClose={() => setOpen(false)} onConfirm={() => setOpen(false)} ctaLabel="Close" footer={<div className="border-t border-border p-3 text-right"><button type="button" onClick={() => setOpen(false)} className="font-semibold text-hms-blue">Close</button></div>} title="Saved diagnostic captures">
      <p className="mb-3 text-sm text-fg-muted">Captures are saved on the server and remain available after disconnection. Live display filters and pauses do not affect the files.</p>
      {error ? <p role="alert">{error}</p> : archives === null ? <p>Loading captures…</p> : archives.length === 0 ? <p>No saved captures yet.</p> :
        <div className="max-h-[420px] overflow-auto"><ul className="space-y-2">{archives.map((archive) => <li key={archive.id} className="rounded border border-border p-3">
          <a href={diagnosticDownloadUrl(archive.id)} download className="font-semibold text-hms-blue hover:underline">{archive.host} · {new Date(archive.startedAt).toLocaleString()}</a>
          <p className="text-xs text-fg-muted">{archive.count.toLocaleString()} lines · {(archive.bytes / 1048576).toFixed(1)} MB</p>
          {(archive.error || archive.dropped > 0) && <p className="text-xs text-error">{archive.error} · {archive.dropped} lines missing</p>}
        </li>)}</ul></div>}
    </Modal>}
  </>;
}
