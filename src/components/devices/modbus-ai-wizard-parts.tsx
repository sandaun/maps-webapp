"use client";

import * as React from "react";
import Link from "next/link";
import { Check, ChevronDown, FileText, Upload, X } from "lucide-react";
import type {
  CandidateSignal,
  ModbusAIJob,
  ValidationResult,
  AIProvider,
} from "@/core/modbus-ai/model";
import { BYTE_ORDERS, DATA_TYPES, wordCount } from "@/core/modbus-ai/model";
import type { ScanJob } from "@/core/modbus-scan/model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const WIZARD_STEPS = [
  "Document",
  "Map",
  "Live check",
  "Import",
] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];
export const PROVIDER_NAMES: Record<AIProvider, string> = {
  openai: "OpenAI",
  anthropic: "Claude",
  kimi: "Kimi",
};
export const tableHeading =
  "px-3 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-fg-muted";
export const tableCell = "px-3 py-2.5";

export function WizardHeader({
  step,
  job,
  node,
  mapReviewed,
  skipped,
  onStep,
  onClose,
}: {
  step: WizardStep;
  job?: ModbusAIJob;
  node: string;
  mapReviewed: boolean;
  skipped: boolean;
  onStep: (step: WizardStep) => void;
  onClose: () => void;
}) {
  const current = WIZARD_STEPS.indexOf(step);
  const ready = job?.state === "ready";
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-7 gap-y-3 border-b border-border px-[22px] py-4">
      <div className="min-w-[185px]">
        <h2 className="font-display text-[19px] font-light text-hms-blue">
          Add Modbus device
        </h2>
        <p className="mt-0.5 text-[11px] text-fg-muted">{node}</p>
      </div>
      <nav
        aria-label="Add Modbus device steps"
        className="order-3 flex w-full items-center lg:order-none lg:min-w-0 lg:flex-1"
      >
        {WIZARD_STEPS.map((name, index) => {
          const done = (index === 0 && ready) || (index === 1 && mapReviewed);
          const isSkipped = index === 2 && skipped && current === 3;
          const disabled = index > 0 && !ready;
          const active = index === current;
          const sub =
            index === 0
              ? job?.pages.length
                ? `${job.pages.length} ${job.pages.length === 1 ? "page" : "pages"}`
                : "PDF"
              : index === 1
                ? ready
                  ? `${job.signals.length} signals`
                  : "Needs a map"
                : index === 2
                  ? isSkipped
                    ? "Skipped"
                    : "Optional"
                  : ready
                    ? `${job.signals.filter((row) => row.enabled).length} signals`
                    : "";
          return (
            <React.Fragment key={name}>
              <button
                type="button"
                disabled={disabled}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded p-1 text-left outline-hms-accent disabled:cursor-not-allowed disabled:opacity-45",
                  active ? "text-hms-blue" : "text-fg-muted",
                )}
                onClick={() => onStep(name)}
              >
                <span
                  className={cn(
                    "flex size-[23px] shrink-0 items-center justify-center rounded-full border font-mono text-[11px]",
                    active
                      ? "border-2 border-hms-accent text-hms-accent"
                      : isSkipped
                        ? "border-dashed border-fg-subtle"
                        : done
                          ? "border-hms-accent bg-hms-accent text-white"
                          : "border-border-strong",
                  )}
                >
                  {done && !active ? (
                    <Check size={12} aria-hidden />
                  ) : isSkipped ? (
                    "–"
                  ) : (
                    index + 1
                  )}
                </span>
                <span className="min-w-0 leading-tight">
                  <span
                    className={cn(
                      "block whitespace-nowrap text-[12px]",
                      active ? "font-bold" : "font-semibold",
                    )}
                  >
                    {name}
                  </span>
                  <span className="hidden whitespace-nowrap text-[10.5px] text-fg-muted sm:block">
                    {sub}
                  </span>
                </span>
              </button>
              {index < 3 && (
                <span
                  aria-hidden
                  className={cn(
                    "mx-2 h-px min-w-2 flex-1",
                    done ? "bg-hms-accent" : "bg-border",
                  )}
                />
              )}
            </React.Fragment>
          );
        })}
      </nav>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="ml-auto size-7"
        aria-label="Close Add Modbus device"
        onClick={onClose}
      >
        <X size={15} aria-hidden />
      </Button>
    </header>
  );
}

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "error" | "read" | "unvalidated";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        tone === "success"
          ? "border-success-border bg-success-bg text-success"
          : tone === "warning"
            ? "border-warning-border bg-warning-bg text-warning-text"
            : tone === "error"
              ? "border-error-border bg-error-bg text-error"
              : tone === "read"
                ? "border-info-border bg-white text-hms-accent"
                : tone === "unvalidated"
                  ? "border-dashed border-border-strong bg-white text-fg-muted"
                  : "border-border bg-white text-fg-muted",
      )}
    >
      {children}
    </span>
  );
}

/** Labels describe existing evidence; decoding a payload does not prove its meaning. */
export function liveResult(
  row: CandidateSignal,
  result?: ValidationResult,
  scan?: ScanJob,
): {
  label: string;
  tone: "neutral" | "success" | "warning" | "error" | "read" | "unvalidated";
} {
  if (row.access === "W" || row.access === "Trigger")
    return { label: "Not read", tone: "neutral" };
  const point = scan?.results.find(
    (p) => p.function === row.function && p.address === row.address,
  );
  if (point?.status === "exception")
    return { label: "Exception", tone: "error" };
  if (point?.status === "timeout")
    return { label: "No response", tone: "error" };
  if (result?.checks.address.state === "contradicted")
    return { label: "Exception", tone: "error" };
  if (result?.checks.type.state === "contradicted")
    return { label: "Out of range", tone: "warning" };
  if (
    result?.checks.scale.state === "contradicted" ||
    result?.checks.meaning.state === "contradicted"
  )
    return { label: "Test mismatch", tone: "warning" };
  if (result?.lastRaw && result.lastValue === undefined)
    return { label: "Needs review", tone: "warning" };
  if (
    result?.checks.meaning.state === "supported" &&
    result.checks.scale.state === "supported" &&
    result.lastValue !== undefined
  )
    return { label: "Live-validated", tone: "success" };
  if (result?.lastValue !== undefined)
    return { label: "Read OK", tone: "read" };
  if (result?.checks.address.evidence.some((e) => e.startsWith("No reply.")))
    return { label: "No response", tone: "error" };
  return {
    label: scan ? "Waiting…" : "Not live-validated",
    tone: scan ? "neutral" : "unvalidated",
  };
}

export function ExtractionProgress({ job }: { job: ModbusAIJob }) {
  const chunks = (job.extractionChunks ?? [])
    .filter((c) => c.state !== "split")
    .sort((a, b) => a.startPage - b.startPage);
  const total = job.pages.length || chunks.at(-1)?.endPage || 1;
  const running = chunks.find((c) => c.state === "running");
  const savedRows = chunks
    .filter((c) => c.state === "complete")
    .reduce((n, c) => n + c.rows, 0);
  const preview = job.extractionPreview;
  const received =
    savedRows +
    (preview &&
    !chunks.some((c) => c.id === preview.chunkId && c.state === "complete")
      ? preview.count
      : 0);
  const failed = job.state === "failed";
  const title = failed
    ? "Extraction interrupted"
    : running
      ? `Reading pages ${running.startPage}–${running.endPage} of ${total}…`
      : "Preparing your document…";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3" role="status">
        <p className="text-[13px] font-bold text-hms-blue">{title}</p>
        <span className="text-xs text-fg-muted">
          {received} source rows received
        </span>
      </div>
      <div
        className="flex h-1.5 overflow-hidden rounded-full bg-hms-muted"
        role="progressbar"
        aria-label="PDF pages read"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={chunks
          .filter((c) => c.state === "complete")
          .reduce((n, c) => n + c.endPage - c.startPage + 1, 0)}
      >
        {chunks.map((c) => (
          <span
            key={c.id}
            style={{
              width: `${((c.endPage - c.startPage + 1) / total) * 100}%`,
            }}
            title={`Pages ${c.startPage}–${c.endPage}: ${c.state === "complete" ? "read" : failed && c.state === "running" ? "interrupted" : c.state === "running" ? "reading" : "not read"}`}
            className={cn(
              "h-full",
              c.state === "complete"
                ? "bg-hms-accent"
                : c.state === "running"
                  ? failed
                    ? "bg-error/70"
                    : "animate-pulse bg-hms-accent/40"
                  : "bg-hms-muted",
            )}
          />
        ))}
      </div>
      {failed && (
        <div className="flex flex-wrap gap-2 text-[11px]">
          {chunks.map((c) => (
            <span
              key={c.id}
              className={
                c.state === "complete"
                  ? "text-hms-accent"
                  : c.state === "running"
                    ? "text-error"
                    : "text-fg-muted"
              }
            >
              p. {c.startPage}–{c.endPage} ·{" "}
              {c.state === "complete"
                ? "read"
                : c.state === "running"
                  ? "interrupted"
                  : "not read"}
            </span>
          ))}
        </div>
      )}
      {failed && (
        <p className="rounded border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning-text">
          Saved progress is kept. Resume to finish the document before reviewing
          or importing the map.
        </p>
      )}
      {preview?.rows.length ? (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-table-header">
              <tr>
                <th className={tableHeading}>Signal</th>
                <th className={tableHeading}>Source address</th>
                <th className={tableHeading}>Page</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row, i) => (
                <tr key={i} className="border-t border-row-rule">
                  <td className={tableCell}>{row.name}</td>
                  <td className={cn(tableCell, "font-mono")}>
                    {row.sourceAddress || "—"}
                  </td>
                  <td className={cn(tableCell, "font-mono text-fg-muted")}>
                    {row.sourcePages.join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-border bg-card-foot px-3 py-2 text-[11px] text-fg-muted">
            Latest received rows. Addresses and types are reviewed in the
            completed map.
          </p>
        </div>
      ) : (
        <p className="text-xs text-fg-muted">
          Signals will appear here as the document is read.
        </p>
      )}
    </div>
  );
}

export function DocumentStep({
  job,
  file,
  jobs,
  provider,
  model,
  providerReady,
  settingsLoaded,
  disabled,
  onFile,
  onLoad,
  onExplore,
  onNew,
  recovery,
}: {
  job?: ModbusAIJob;
  file: File | null;
  jobs: ModbusAIJob[];
  provider: AIProvider;
  model: string;
  providerReady: boolean;
  settingsLoaded: boolean;
  disabled: boolean;
  onFile: (file: File) => void;
  onLoad: (id: string) => void;
  onExplore?: () => void;
  onNew: () => void;
  recovery?: React.ReactNode;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const processing = job && job.state !== "ready";
  const name = job?.fileName ?? file?.name;
  return (
    <div
      className={cn(
        "mx-auto w-full px-6 py-7",
        processing
          ? "max-w-[900px]"
          : "flex max-w-[760px] flex-1 flex-col justify-center pb-10",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept="application/pdf,.pdf"
        aria-label="Choose Modbus PDF"
        onChange={(event) => {
          const picked = event.target.files?.[0];
          if (picked) onFile(picked);
          event.target.value = "";
        }}
      />
      {name ? (
        <div className="mb-5 flex items-center gap-3 rounded-md border border-border bg-white p-3">
          <span className="flex h-12 w-10 shrink-0 items-center justify-center rounded bg-info-bg text-hms-blue">
            <FileText size={20} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold">{name}</p>
            <p className="mt-1 text-xs text-fg-muted">
              {file && !job
                ? `${(file.size / 1024 / 1024).toFixed(1)} MB · PDF`
                : `${job?.pages.length || "…"} ${job?.pages.length === 1 ? "page" : "pages"} · ${PROVIDER_NAMES[job?.profile.provider ?? provider]}`}
            </p>
          </div>
          {!disabled && (
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label="Choose another PDF"
              onClick={onNew}
            >
              <X size={14} aria-hidden />
            </Button>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!disabled && event.dataTransfer.files[0])
              onFile(event.dataTransfer.files[0]);
          }}
          className={cn(
            "flex min-h-[220px] w-full flex-col items-center justify-center gap-3 rounded-md border border-dashed px-5 text-center outline-hms-accent transition-colors hover:border-hms-accent hover:bg-info-bg/40 disabled:opacity-50",
            dragging
              ? "border-hms-accent bg-info-bg"
              : "border-border-strong bg-[#FAFBFC]",
          )}
        >
          <Upload size={28} className="mb-1 text-hms-accent" aria-hidden />
          <span className="text-[14px] font-bold text-hms-blue">
            Drop the device&apos;s Modbus PDF here or click to choose
          </span>
          <span className="text-[12px] text-fg-muted">
            PDF · up to 20 MB · 200 pages
          </span>
        </button>
      )}
      {processing ? (
        <div className="space-y-4">
          <ExtractionProgress job={job} />
          {recovery}
          {job.state === "failed" && (
            <Link
              href="/settings"
              className="inline-block text-xs font-semibold text-hms-accent hover:underline"
            >
              Open Settings
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
            <span className="rounded border border-border px-1 font-mono text-[10px]">
              AI
            </span>
            <span>
              {PROVIDER_NAMES[provider]} · {model}
            </span>
            <Link
              href="/settings"
              className="ml-1 text-[11px] text-hms-accent hover:underline"
            >
              Settings
            </Link>
          </div>
          {settingsLoaded && !providerReady && (
            <p className="mt-3 rounded border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning-text">
              No key is configured for {PROVIDER_NAMES[provider]}.{" "}
              <Link
                href="/settings"
                className="font-semibold text-hms-accent underline"
              >
                Open Settings
              </Link>{" "}
              to check the AI setup.
            </p>
          )}
          <div className="mt-6 flex flex-wrap items-start gap-x-3 gap-y-2 border-t border-border pt-4 text-xs">
            <details className="min-w-0 flex-1">
              <summary className="flex w-fit cursor-pointer list-none items-center gap-1 font-semibold text-hms-accent">
                Or open a recent map <ChevronDown size={12} aria-hidden />
              </summary>
              <div className="mt-3 overflow-hidden rounded-md border border-border bg-white shadow-sm">
                {jobs.length ? (
                  jobs.map((saved) => (
                    <button
                      key={saved.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => onLoad(saved.id)}
                      className="flex w-full items-center gap-3 border-b border-row-rule px-3 py-3 text-left hover:bg-row-hover disabled:opacity-50"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">
                          {saved.fileName}
                        </span>
                        <span className="mt-1 block text-[11px] text-fg-muted">
                          {[saved.manufacturer, saved.model]
                            .filter(Boolean)
                            .join(" · ") || "Document map"}{" "}
                          · {saved.signals.length} signals ·{" "}
                          {saved.state === "ready"
                            ? saved.runs.length
                              ? "Has captures"
                              : "Not live-validated"
                            : saved.state === "failed"
                              ? "Resume needed"
                              : "Generating map"}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10px] text-fg-muted">
                        {new Date(saved.updatedAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="p-3 text-fg-muted">
                    No saved maps for this project yet.
                  </p>
                )}
              </div>
            </details>
            {onExplore && (
              <button
                type="button"
                disabled={disabled}
                onClick={onExplore}
                className="text-fg-muted hover:text-hms-accent hover:underline disabled:opacity-50"
              >
                Explore without a PDF
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function ValidationDetails({ result }: { result?: ValidationResult }) {
  return (
    <section
      className="space-y-3 border-t border-border pt-4"
      aria-label="Validation details"
    >
      <h3 className="text-[13px] font-bold text-hms-blue">Live evidence</h3>
      {(["address", "type", "scale", "meaning"] as const).map((key) => {
        const check = result?.checks[key];
        const label =
          check?.state === "supported"
            ? key === "type"
              ? "Plausible"
              : key === "address"
                ? "Read OK"
                : "Supported by test"
            : check?.state === "contradicted"
              ? "Contradicted"
              : "Pending";
        return (
          <details key={key} className="text-xs">
            <summary className="flex cursor-pointer items-center justify-between gap-2 capitalize">
              <span>{key}</span>
              <span
                className={cn(
                  "text-[11px]",
                  check?.state === "contradicted"
                    ? "text-warning-text"
                    : check?.state === "supported"
                      ? "text-hms-accent"
                      : "text-fg-muted",
                )}
              >
                {label}
              </span>
            </summary>
            <div className="mt-2 space-y-1 border-l border-border pl-2 text-[11px] leading-relaxed text-fg-muted">
              {check?.evidence.length ? (
                check.evidence.map((text, i) => <p key={i}>{text}</p>)
              ) : (
                <p>
                  {key === "scale" || key === "meaning"
                    ? "A guided change is needed to check this claim."
                    : "No evidence for this check yet."}
                </p>
              )}
            </div>
          </details>
        );
      })}
      {result?.lastAt && (
        <p className="text-[10px] text-fg-muted">
          {result.samples} samples · last successful response{" "}
          {new Date(result.lastAt).toLocaleTimeString("en-GB")}
        </p>
      )}
      {result?.warnings.map((warning, index) => (
        <p
          key={index}
          className="rounded bg-warning-bg px-2 py-1.5 text-[11px] leading-relaxed text-warning-text"
        >
          {warning}
        </p>
      ))}
    </section>
  );
}

export function SignalEditor({
  row,
  index,
  total,
  jobId,
  readOnly,
  canEdit,
  result,
  onPatch,
  onClose,
  onEditMap,
  children,
}: {
  row: CandidateSignal;
  index: number;
  total: number;
  jobId: string;
  readOnly: boolean;
  canEdit: boolean;
  result?: ValidationResult;
  onPatch: (patch: Partial<CandidateSignal>) => void;
  onClose: () => void;
  onEditMap: () => void;
  children?: React.ReactNode;
}) {
  const disabled = !canEdit || readOnly;
  const id = (key: string) => `ai-signal-${row.id}-${key}`;
  const field = (
    label: string,
    key: string,
    control: React.ReactNode,
    span = 1,
  ) => (
    <div
      className={cn(
        "min-w-0 space-y-1",
        span === 3 ? "col-span-3" : span === 2 ? "col-span-2" : "",
      )}
    >
      <label
        htmlFor={id(key)}
        className="block text-[10px] uppercase tracking-wider text-fg-muted"
      >
        {label}
      </label>
      {control}
    </div>
  );
  const numeric = (key: "scale" | "offset" | "min" | "max" | "bit") => (
    <Input
      id={id(key)}
      type="number"
      step={key === "bit" ? 1 : "any"}
      min={key === "bit" ? 0 : undefined}
      max={key === "bit" ? 15 : undefined}
      disabled={disabled || (key === "bit" && row.function <= 2)}
      value={row[key] ?? ""}
      className="font-mono text-xs"
      onChange={(event) =>
        onPatch({
          [key]: event.target.value === "" ? null : Number(event.target.value),
        })
      }
    />
  );
  const sourceQuote = (
    <div className="rounded-md border border-border bg-[#F6F8FA] p-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-fg-muted">
        <span>
          From PDF ·{" "}
          {row.sourcePages.length
            ? `p. ${row.sourcePages.join(", ")}`
            : "No page"}
        </span>
        {row.sourcePages[0] && (
          <a
            href={`/api/modbus-ai/jobs/${jobId}/export?format=pdf#page=${row.sourcePages[0]}`}
            target="_blank"
            rel="noreferrer"
            className="normal-case tracking-normal text-hms-accent hover:underline"
          >
            Open page
          </a>
        )}
      </div>
      <p className="text-[12px] leading-relaxed">
        {row.sourceQuote
          ? `“${row.sourceQuote}”`
          : "No source quote. Check this signal against the device documentation."}
      </p>
    </div>
  );
  return (
    <aside
      className="flex min-h-0 flex-col border-l border-border bg-white"
      aria-label="Signal details"
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-4">
        <div className="min-w-0">
          <h3 className="truncate text-[14px] font-bold text-hms-blue">
            {row.name}
          </h3>
          <p className="mt-1 font-mono text-[10.5px] text-fg-muted">
            Signal {index + 1} of {total}
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          aria-label="Close signal details"
          onClick={onClose}
        >
          <X size={13} aria-hidden />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-4">
        {readOnly ? (
          <details className="text-xs text-fg-muted">
            <summary className="cursor-pointer">Source quote</summary>
            <div className="mt-2">{sourceQuote}</div>
          </details>
        ) : (
          sourceQuote
        )}
        {row.warnings.length > 0 && (
          <div className="space-y-2 rounded border border-warning-border bg-warning-bg p-3 text-[11.5px] leading-relaxed text-warning-text">
            {row.warnings.map((warning, i) => (
              <p key={i}>{warning}</p>
            ))}
          </div>
        )}
        {readOnly ? (
          <details className="text-xs text-fg-muted">
            <summary className="cursor-pointer">Encoding from document</summary>
            <div className="mt-2 grid grid-cols-2 gap-3 text-text-body">
              <div>
                <p className="mb-1 text-[10px] uppercase text-fg-muted">
                  Register
                </p>
                <p className="font-mono">
                  FC0{row.function} · {row.address}
                </p>
              </div>
              <div>
                <p className="mb-1 text-[10px] uppercase text-fg-muted">
                  {wordCount(row) > 1 ? "Type / order" : "Type"}
                </p>
                <p className="font-mono">
                  {row.dataType.toUpperCase()}
                  {wordCount(row) > 1 &&
                    ` · ${row.byteOrder ?? "Undocumented"}`}
                </p>
              </div>
              <div>
                <p className="mb-1 text-[10px] uppercase text-fg-muted">
                  Scale / offset
                </p>
                <p className="font-mono">
                  {row.scale ?? "Undocumented"} / {row.offset ?? "Undocumented"}
                </p>
              </div>
              <div>
                <p className="mb-1 text-[10px] uppercase text-fg-muted">Unit</p>
                <p>{row.unit ?? "—"}</p>
              </div>
            </div>
          </details>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {field(
              "Name",
              "name",
              <Input
                id={id("name")}
                disabled={disabled}
                value={row.name}
                onChange={(e) => onPatch({ name: e.target.value })}
              />,
              3,
            )}
            {field(
              "FC",
              "function",
              <Select
                id={id("function")}
                disabled={disabled}
                value={row.function}
                options={[
                  { value: "1", label: "01 · Coils" },
                  { value: "2", label: "02 · Discrete inputs" },
                  { value: "3", label: "03 · Holding" },
                  { value: "4", label: "04 · Input" },
                ]}
                onValueChange={(value) =>
                  onPatch({
                    function: Number(value) as CandidateSignal["function"],
                    ...(Number(value) <= 2
                      ? { dataType: "bit" as const, bit: null }
                      : {}),
                  })
                }
              />,
              2,
            )}
            {field(
              "Address · base 0",
              "address",
              <Input
                id={id("address")}
                disabled={disabled}
                type="number"
                min={0}
                max={65535}
                value={row.address}
                className="font-mono text-xs"
                onChange={(e) =>
                  onPatch({
                    address: Number(e.target.value),
                    addressBasis: "explicit",
                  })
                }
              />,
            )}
            {field(
              "Type",
              "dataType",
              <Select
                id={id("dataType")}
                disabled={disabled}
                value={row.dataType}
                options={(row.function <= 2 ? ["bit"] : DATA_TYPES).map(
                  (value) => ({ value, label: value.toUpperCase() }),
                )}
                onValueChange={(value) =>
                  onPatch({ dataType: value as CandidateSignal["dataType"] })
                }
              />,
              wordCount(row) > 1 ? 1 : 3,
            )}
            {wordCount(row) > 1 &&
              field(
                "Byte / word order",
                "byteOrder",
                <Select
                  id={id("byteOrder")}
                  disabled={disabled || row.function <= 2}
                  value={row.byteOrder ?? ""}
                  options={[
                    { value: "", label: "Undocumented" },
                    ...BYTE_ORDERS.map((value) => ({ value, label: value })),
                  ]}
                  onValueChange={(value) =>
                    onPatch({
                      byteOrder: value
                        ? (value as CandidateSignal["byteOrder"])
                        : null,
                    })
                  }
                />,
                2,
              )}
            {field("Scale", "scale", numeric("scale"))}
            {field("Offset", "offset", numeric("offset"))}
            {field(
              "Unit",
              "unit",
              <Input
                id={id("unit")}
                disabled={disabled}
                value={row.unit ?? ""}
                onChange={(e) => onPatch({ unit: e.target.value || null })}
              />,
            )}
            {field("Bit", "bit", numeric("bit"))}
            {field("Min", "min", numeric("min"))}
            {field("Max", "max", numeric("max"))}
            {field(
              "Access from PDF",
              "access",
              <Select
                id={id("access")}
                disabled={disabled}
                value={row.access}
                options={["R", "W", "R/W", "Trigger", "unknown"].map(
                  (value) => ({ value, label: value }),
                )}
                onValueChange={(value) =>
                  onPatch({ access: value as CandidateSignal["access"] })
                }
              />,
              3,
            )}
          </div>
        )}
        {(row.enumValues.length > 0 ||
          row.sentinels.length > 0 ||
          row.applicableModels.length > 0 ||
          row.description) && (
          <details className="text-xs text-fg-muted">
            <summary className="cursor-pointer">More from the document</summary>
            <div className="mt-2 space-y-2 text-[11px] leading-relaxed">
              {row.description && <p>{row.description}</p>}
              {row.enumValues.length > 0 && (
                <p>Enum values: {row.enumValues.join(", ")}</p>
              )}
              {row.sentinels.length > 0 && (
                <p>Sentinels: {row.sentinels.join(", ")}</p>
              )}
              {row.applicableModels.length > 0 && (
                <p>Models: {row.applicableModels.join(", ")}</p>
              )}
            </div>
          </details>
        )}
        {readOnly && <ValidationDetails result={result} />}
        {children}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-card-foot px-4 py-3">
        {readOnly ? (
          <Button size="sm" variant="secondary" onClick={onEditMap}>
            Edit in map
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={!canEdit}
              onClick={() => onPatch({ enabled: !row.enabled })}
            >
              {row.enabled ? "Exclude" : "Include"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!canEdit}
              onClick={() => onPatch({ reviewed: !row.reviewed })}
            >
              {row.reviewed ? "Mark as pending" : "Mark as reviewed"}
            </Button>
          </>
        )}
      </div>
    </aside>
  );
}
