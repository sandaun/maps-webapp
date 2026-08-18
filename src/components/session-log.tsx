"use client";

import * as React from "react";
import type { LogEntry, TransferProgress } from "@/lib/use-session-events";

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleTimeString("en-GB", { hour12: false });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

/** XMODEM transfer progress bar. */
export function TransferProgressBar({ progress }: { progress: TransferProgress }) {
  const percent =
    progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.receivedBytes / progress.totalBytes) * 100))
      : 0;
  return (
    <div className="space-y-1" aria-label="Transfer progress">
      <div className="h-2 w-full overflow-hidden rounded-full bg-hms-muted">
        <div className="h-full bg-hms-pop transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <p className="font-mono text-[11px] text-fg-muted">
        {formatBytes(progress.receivedBytes)} / {formatBytes(progress.totalBytes)} ({percent}%)
      </p>
    </div>
  );
}

/**
 * Scrolling mono console for the session activity log (SSE). Renders server
 * lines verbatim — the server never includes credentials in them.
 */
export function SessionLog({ log, emptyHint }: { log: LogEntry[]; emptyHint: string }) {
  const bodyRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  return (
    <div
      ref={bodyRef}
      aria-label="Activity log"
      className="h-64 overflow-auto rounded bg-[#0B2233] px-3 py-2 font-mono text-[11.5px] leading-relaxed text-[#B9D6EA]"
    >
      {log.length === 0 ? (
        <p className="text-[#5B7A90]">{emptyHint}</p>
      ) : (
        log.map((entry, index) => (
          <div key={index} className="whitespace-pre-wrap">
            <span className="text-[#5B7A90]">{formatTime(entry.at)} </span>
            {entry.line}
          </div>
        ))
      )}
    </div>
  );
}
