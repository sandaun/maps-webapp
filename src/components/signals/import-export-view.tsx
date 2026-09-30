"use client";

import * as React from "react";
import type { FamilyId, ProjectMeta } from "@/lib/project-types";
import {
  exportProjectUrl,
  importSignalsXlsx,
  listProjectHistory,
  restoreProjectHistory,
  signalsXlsxUrl,
  type ProjectHistoryEntry,
} from "@/lib/api";
import { isMapsVersion } from "@/core/project-format/maps-version";
import { cn } from "@/lib/utils";

const HISTORY_PREVIEW_LIMIT = 4;

export function ImportExportView({
  family,
  projectId,
  projectName,
  signalCount,
  mapsVersion,
  lastImport,
  onImported,
}: {
  family: FamilyId;
  projectId: string;
  projectName: string;
  signalCount: number;
  /** The project's MAPS version: the default target of the signal table. */
  mapsVersion: string;
  lastImport?: ProjectMeta["lastImport"];
  onImported: () => void;
}) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [history, setHistory] = React.useState<ProjectHistoryEntry[]>([]);
  const [historyExpanded, setHistoryExpanded] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  // MAPS only imports a table written for its own version (B3), so the user
  // picks the MAPS that will read it; the project's by default.
  const [targetVersion, setTargetVersion] = React.useState(mapsVersion);
  const targetVersionValid = isMapsVersion(targetVersion);
  // MAPS "Add signals" / "Replace signals" (`frmImport`); ME–MBS is not a MAPS table yet.
  const replaceAvailable = family !== "me-mbs";
  const [importMode, setImportMode] = React.useState<"add" | "replace">("add");

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
      await importSignalsXlsx(projectId, file, replaceAvailable ? importMode : "add");
      onImported();
      loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  // MBS–KNX: ESF is out of the first iteration (docs/reference/mbs-knx-analisi.md §8).
  const exports =
    family === "mbs-knx"
      ? [
          {
            kind: "XLSX",
            label: "Signal table",
            sub: `${signalCount} rows · all columns`,
            href: signalsXlsxUrl(projectId, targetVersion.trim()),
          },
          {
            kind: "PROJ",
            label: "Whole project (.ibmaps)",
            sub: "Configuration and signals",
            href: exportProjectUrl(projectId),
          },
        ]
      : family === "knx-mbm"
      ? [
          {
            kind: "XLSX",
            label: "Signal table",
            sub: `${signalCount} rows · all columns`,
            href: signalsXlsxUrl(projectId, targetVersion.trim()),
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
            href: signalsXlsxUrl(projectId, targetVersion.trim()),
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
            {family === "me-mbs"
              ? "Bring in a signal table prepared offline. Rows are appended like MAPS desktop Add from Excel."
              : "Bring in a signal table exported by MAPS desktop or prepared offline, like MAPS Import from Excel."}
          </p>
          {replaceAvailable ? (
            <fieldset className="mb-3 flex gap-5 text-[12.5px] text-text-body">
              <legend className="sr-only">Import mode</legend>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="import-mode"
                  checked={importMode === "add"}
                  onChange={() => setImportMode("add")}
                />
                Add signals
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="import-mode"
                  checked={importMode === "replace"}
                  onChange={() => setImportMode("replace")}
                />
                Replace signals
              </label>
            </fieldset>
          ) : null}
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
                {lastImport.rows} rows{lastImport.mode === "replace" ? " · replaced" : ""}
                {lastImport.warning ? (
                  <span role="status" className="mt-1 block text-warning-text">
                    {lastImport.warning}
                  </span>
                ) : null}
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
          <label className="mb-3 block text-[12px] text-fg-muted">
            <span className="mb-1 block font-bold text-hms-blue">Target MAPS version</span>
            <input
              type="text"
              value={targetVersion}
              onChange={(e) => setTargetVersion(e.target.value)}
              aria-invalid={!targetVersionValid}
              className={cn(
                "w-[140px] rounded-[4px] border px-2 py-1 font-mono text-[12.5px] text-text-body",
                targetVersionValid ? "border-border" : "border-error",
              )}
            />
            <span className={cn("mt-1 block", targetVersionValid ? "" : "text-error")}>
              {targetVersionValid
                ? "Signal tables are written for this MAPS version: MAPS only imports tables of its own version."
                : "Use four numbers, such as 1.2.34.0."}
            </span>
          </label>
          <div className="flex flex-col gap-[9px]">
            {exports.map((item) => {
              const disabled = item.label === "Signal table" && !targetVersionValid;
              return (
              <a
                key={`${item.kind}-${item.label}`}
                href={disabled ? undefined : item.href}
                aria-disabled={disabled || undefined}
                className={cn(
                  "flex items-center gap-[11px] rounded-[5px] border border-border px-[13px] py-[11px]",
                  disabled ? "cursor-not-allowed opacity-50" : "hover:border-hms-accent hover:bg-[#F7FBFE]",
                )}
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
              );
            })}
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
