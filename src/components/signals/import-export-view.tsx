"use client";

import * as React from "react";
import type { FamilyId, ProjectMeta } from "@/lib/project-types";
import {
  exportProjectUrl,
  importSignalsXlsx,
  listProjectHistory,
  restoreProjectHistory,
  type ProjectHistoryEntry,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const HISTORY_PREVIEW_LIMIT = 4;

export function ImportExportView({
  family,
  projectId,
  projectName,
  signalCount,
  lastImport,
  onImported,
}: {
  family: FamilyId;
  projectId: string;
  projectName: string;
  signalCount: number;
  lastImport?: ProjectMeta["lastImport"];
  onImported: () => void;
}) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [history, setHistory] = React.useState<ProjectHistoryEntry[]>([]);
  const [historyExpanded, setHistoryExpanded] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);

  const loadHistory = React.useCallback(() => {
    void listProjectHistory(projectId).then(setHistory).catch(() => setHistory([]));
  }, [projectId]);

  React.useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  async function handleXlsx(file: File) {
    setBusy(true);
    setError(null);
    try {
      await importSignalsXlsx(projectId, file);
      onImported();
      loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const exports =
    family === "knx-mbm"
      ? [
          {
            kind: "XLSX",
            label: "Signal table",
            sub: `${signalCount} rows · all columns`,
            href: `/api/projects/${encodeURIComponent(projectId)}/export/xlsx`,
          },
          {
            kind: "ESF",
            label: "KNX group addresses for ETS",
            sub: "Group address, DPT, description",
            href: `/api/projects/${encodeURIComponent(projectId)}/export/esf`,
          },
          {
            kind: "XLSX",
            label: "Modbus poll plan",
            sub: "Devices · poll records",
            href: `/api/projects/${encodeURIComponent(projectId)}/export/poll-plan`,
          },
          {
            kind: "PROJ",
            label: "Whole project (.ibmaps)",
            sub: "Configuration, devices and signals",
            href: exportProjectUrl(projectId),
          },
        ]
      : [
          {
            kind: "XLSX",
            label: "Signal table",
            sub: `${signalCount} rows · all columns`,
            href: `/api/projects/${encodeURIComponent(projectId)}/export/xlsx`,
          },
          {
            kind: "PROJ",
            label: "Whole project (.ibmaps)",
            sub: "Configuration, devices and signals",
            href: exportProjectUrl(projectId),
          },
        ];

  const visibleHistory = historyExpanded ? history : history.slice(0, HISTORY_PREVIEW_LIMIT);
  const hiddenHistoryCount = history.length - visibleHistory.length;

  return (
    <div className="max-w-[1000px] px-5 py-5 pb-9">
      <div className="mb-4 grid grid-cols-1 gap-3.5 md:grid-cols-2">
        <section className="rounded-lg border border-border bg-white p-[18px]">
          <h2 className="font-display text-[17px] font-light text-hms-blue">Import signals from XLSX</h2>
          <p className="mb-3.5 mt-1.5 text-[12.5px] leading-[1.55] text-fg-muted">
            Bring in a signal table prepared offline. Rows are appended like MAPS desktop Add from Excel; virtual
            rows (data length “-”) update the matching virtual signal.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            aria-label="Import XLSX"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleXlsx(file);
            }}
          />
          <button
            type="button"
            disabled={busy}
            className={cn(
              "w-full cursor-pointer rounded-[6px] border-[1.5px] border-dashed px-6 py-6 text-center",
              dragOver
                ? "border-hms-accent bg-[#F7FBFE]"
                : "border-border-strong bg-[#FBFBFC] hover:border-hms-accent hover:bg-[#F7FBFE]",
            )}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file) void handleXlsx(file);
            }}
          >
            <div className="text-[13px] font-bold text-hms-blue">Choose an XLSX file</div>
            <div className="mt-1 text-[11.5px] text-fg-subtle">or drop it here · max 5 000 rows</div>
          </button>
          <div className="mt-3.5 text-[12px] text-fg-muted">
            Last import:{" "}
            {lastImport ? (
              <>
                <span className="font-mono">{lastImport.fileName}</span> · {formatWhen(lastImport.at)} ·{" "}
                {lastImport.rows} rows
              </>
            ) : (
              "—"
            )}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-white p-[18px]">
          <h2 className="font-display text-[17px] font-light text-hms-blue">Export</h2>
          <p className="mb-3.5 mt-1.5 text-[12.5px] leading-[1.55] text-fg-muted">
            Export the current table to reuse it in another project or to hand the register map to the BMS
            integrator.
          </p>
          <div className="flex flex-col gap-[9px]">
            {exports.map((item) => (
              <a
                key={`${item.kind}-${item.label}`}
                href={item.href}
                className="flex items-center gap-[11px] rounded-[5px] border border-border px-[13px] py-[11px] hover:border-hms-accent hover:bg-[#F7FBFE]"
              >
                <span className="rounded-[3px] bg-hms-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-hms-blue">
                  {item.kind}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-bold text-hms-blue">{item.label}</span>
                  <span className="block text-[11.5px] text-fg-muted">{item.sub}</span>
                </span>
                <span className="text-[13px] text-hms-accent">↓</span>
              </a>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-border bg-white p-[18px]">
        <h2 className="mb-3 font-display text-[17px] font-light text-hms-blue">Project file history</h2>
        {history.length === 0 ? (
          <p className="text-[12.5px] text-fg-muted">No snapshots yet. Edits and deploys appear here.</p>
        ) : (
          <>
            {visibleHistory.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-3.5 border-t border-border py-[11px]"
              >
                <div className="w-[118px] font-mono text-[11.5px] text-fg-muted">{formatWhen(entry.at)}</div>
                <span
                  className={cn(
                    "rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                    entry.tag === "draft"
                      ? "bg-warning-bg text-warning-text"
                      : "bg-hms-muted text-hms-blue",
                  )}
                >
                  {entry.tag}
                </span>
                <div className="min-w-0 flex-1 text-[12.5px] text-text-body">{entry.text}</div>
                <div className="text-[12px] text-fg-muted">{entry.who}</div>
                <button
                  type="button"
                  className="text-[12px] font-bold text-hms-accent"
                  onClick={() => {
                    void restoreProjectHistory(projectId, entry.id).then(onImported);
                  }}
                >
                  Restore
                </button>
              </div>
            ))}
            {history.length > HISTORY_PREVIEW_LIMIT ? (
              <button
                type="button"
                className="mt-1 text-[12px] font-bold text-hms-accent"
                onClick={() => setHistoryExpanded((expanded) => !expanded)}
              >
                {historyExpanded ? "Show recent only" : `Show ${hiddenHistoryCount} older versions`}
              </button>
            ) : null}
          </>
        )}
      </section>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-error">
          {error}
        </p>
      ) : null}
      <p className="sr-only">{projectName}</p>
    </div>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `today ${time}` : date.toLocaleString();
}
