"use client";
import * as React from "react";
import {
  SCAN_FUNCTIONS,
  SCAN_FUNCTION_LABELS,
  estimateScan,
  floatInterpretations,
  interpretations,
  isScanTerminal,
  pointKey,
  type ScanInput,
  type ScanJob,
} from "@/core/modbus-scan/model";
import type { NodeLocator, ProjectView } from "@/lib/project-types";
import { request } from "@/lib/api";
import { useCurrentProject } from "@/lib/current-project";
import { useGatewaySession } from "@/lib/gateway-session";
import { usePropertyDrafts } from "@/lib/property-drafts";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const stateLabels = {
  preparing: "Preparing scan batch",
  scanning: "Reading Modbus addresses",
  restoring: "Restoring original gateway project",
  "restore-pending": "Backup restoration pending",
  completed: "Scan complete",
  cancelled: "Scan cancelled",
  failed: "Scan stopped",
};
const PAGE_SIZE = 50;
export function ModbusScanModal({
  initialLocator,
  initialJobId,
  onClose,
  onDocument,
}: {
  initialLocator: NodeLocator;
  initialJobId?: string;
  onClose: () => void;
  onDocument?: () => void;
}) {
  const { view, projectId, mutating, acceptView, setProjectId } =
    useCurrentProject();
  const { session } = useGatewaySession();
  const drafts = usePropertyDrafts();
  const project = view?.family === "knx-mbm" ? view.project : null;
  const [locator, setLocator] = React.useState(initialLocator);
  const [slave, setSlave] = React.useState(1);
  const [base, setBase] = React.useState<0 | 1>(0);
  const [ranges, setRanges] = React.useState(
    SCAN_FUNCTIONS.map((fn) => ({
      function: fn,
      start: 0,
      end: 255,
      enabled: true,
    })),
  );
  const [batchSize, setBatchSize] = React.useState(256);
  const [maxPoints, setMaxPoints] = React.useState(1024);
  const [maxSeconds, setMaxSeconds] = React.useState(600);
  const [jobs, setJobs] = React.useState<ScanJob[]>([]);
  const [job, setJob] = React.useState<ScanJob | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [hideZero, setHideZero] = React.useState(false);
  const [hideFc4, setHideFc4] = React.useState(false);
  const [onlyChanges, setOnlyChanges] = React.useState(false);
  const [page, setPage] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [password, setPassword] = React.useState("");
  const [notice, setNotice] = React.useState<string | null>(null);
  const autoSelectJob = React.useRef(true);
  const nodes = project
    ? [
        ...project.mbm.rtuNodes.map((node, nodeIndex) => ({
          locator: { kind: "rtu" as const, nodeIndex },
          label: `RTU ${nodeIndex + 1} · ${node.baudrate} baud`,
        })),
        ...project.mbm.tcpNodes.map((node, nodeIndex) => ({
          locator: { kind: "tcp" as const, nodeIndex },
          label: `TCP ${nodeIndex + 1} · ${node.ip}:${node.port}`,
        })),
      ]
    : [];
  const hasEdits =
    Object.keys(drafts.snapshot.projects[projectId ?? ""]?.edits ?? {}).length >
    0;
  const active = job !== null && !isScanTerminal(job.state);
  const input: ScanInput = {
    projectId: projectId ?? "",
    locator,
    slave,
    sessionId: session?.id,
    ranges: ranges
      .filter((range) => range.enabled)
      .map(({ function: fn, start, end }) => ({ function: fn, start, end })),
    batchSize,
    maxPoints,
    maxDurationSeconds: maxSeconds,
  };
  const invalidAddress = (value: number) =>
    !Number.isInteger(value) || value < 0 || value > 65535;
  const invalid = {
    slave: !Number.isInteger(slave) || slave < 1 || slave > 247,
    batch: !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 512,
    limit: !Number.isInteger(maxPoints) || maxPoints < 1 || maxPoints > 4096,
    time: !Number.isInteger(maxSeconds) || maxSeconds < 30 || maxSeconds > 1800,
  };
  let estimate: ReturnType<typeof estimateScan> | undefined;
  let problem: string | undefined;
  try {
    if (!ranges.some((range) => range.enabled))
      throw new Error("Select at least one function.");
    if (
      !Number.isInteger(batchSize) ||
      batchSize < 1 ||
      batchSize > 512 ||
      !Number.isInteger(maxPoints) ||
      maxPoints < 1 ||
      maxPoints > 4096 ||
      !Number.isInteger(maxSeconds) ||
      maxSeconds < 30 ||
      maxSeconds > 1800
    )
      throw new Error(
        "Use 1–512 points per batch, up to 4096 total points, and 30–1800 seconds.",
      );
    if (!Number.isInteger(slave) || slave < 1 || slave > 247)
      throw new Error("Use a slave ID from 1 to 247.");
    if (
      input.ranges.some(
        (range) =>
          !Number.isInteger(range.start) ||
          !Number.isInteger(range.end) ||
          range.start < 0 ||
          range.end > 65535,
      )
    )
      throw new Error("Use PDU addresses from 0 to 65535.");
    estimate = estimateScan(input);
  } catch (err) {
    problem = err instanceof Error ? err.message : "Invalid scan settings";
  }
  if (!project) problem = "Open a KNX–Modbus Master project.";
  else if (
    !nodes.some(
      (node) =>
        node.locator.kind === locator.kind &&
        node.locator.nodeIndex === locator.nodeIndex,
    )
  )
    problem = "Choose an existing connection.";
  else if (hasEdits || mutating)
    problem = "Save connection and device edits before starting a scan.";
  else if (
    locator.kind === "rtu" &&
    (!session?.connected || session.gateway?.appId !== 4)
  )
    problem = "Connect to a KNX–MBM gateway in Connection before scanning RTU.";
  else if (locator.kind === "rtu" && (session?.busy || session?.monitoring))
    problem =
      "Stop diagnostics monitoring and wait for the gateway transfer to finish.";

  React.useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const next = await request<{ jobs: ScanJob[] }>("/api/modbus-scans");
        if (disposed) return;
        setJobs(next.jobs);
        const shouldAutoSelect = autoSelectJob.current;
        autoSelectJob.current = false;
        setJob((current) => {
          if (current)
            return (
              next.jobs.find((candidate) => candidate.id === current.id) ??
              current
            );
          if (!shouldAutoSelect) return null;
          return (
            next.jobs.find((candidate) => candidate.id === initialJobId) ??
            next.jobs.find(
              (candidate) =>
                candidate.needsRestore ||
                (candidate.input.projectId === projectId &&
                  !isScanTerminal(candidate.state)),
            ) ??
            null
          );
        });
      } catch (err) {
        if (!disposed)
          setError(
            err instanceof Error ? err.message : "Could not load scan jobs",
          );
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [projectId, initialJobId]);

  const filtered = (job?.results ?? []).filter((row) => {
    if (hideZero && row.samples >= 2 && !row.changed && row.lastValue === 0)
      return false;
    if (onlyChanges && !row.changed) return false;
    if (hideFc4 && row.function === 4) {
      const peer = job?.results.find(
        (other) => other.function === 3 && other.address === row.address,
      );
      if (
        peer &&
        peer.samples >= 2 &&
        row.samples >= 2 &&
        !peer.changed &&
        !row.changed &&
        peer.lastValue === row.lastValue
      )
        return false;
    }
    return true;
  });
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1),
  );
  const visible = filtered.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const canImport =
    !!job &&
    isScanTerminal(job.state) &&
    !job.needsRestore &&
    job.input.projectId === projectId &&
    selected.size > 0 &&
    !hasEdits;

  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan operation failed");
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    if (problem || busy || active) return;
    await action(async () => {
      const next = await request<{ job: ScanJob }>("/api/modbus-scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      setJob(next.job);
      setSelected(new Set());
      setPage(0);
      setNotice(null);
    });
  }
  async function cancel() {
    if (!job) return;
    await action(async () => {
      const next = await request<{ job: ScanJob }>(
        `/api/modbus-scans/${job.id}`,
        { method: "DELETE" },
      );
      setJob(next.job);
    });
  }
  async function restore() {
    if (!job) return;
    await action(async () => {
      const matchingSession =
        session?.host === job.host ? session.id : undefined;
      const next = await request<{ job: ScanJob }>(
        `/api/modbus-scans/${job.id}/restore`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            matchingSession ? { sessionId: matchingSession } : { password },
          ),
        },
      );
      setPassword("");
      setJob(next.job);
    });
  }
  async function addSelected() {
    if (!job || !view || !canImport) return;
    await action(async () => {
      const next = await request<ProjectView>(
        `/api/modbus-scans/${job.id}/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            selected: [...selected],
            revision: view.meta.revision ?? 0,
          }),
        },
      );
      acceptView?.(next);
      setSelected(new Set());
      setNotice(
        "Selected addresses were added to the local project with Modbus writing disabled. Review their KNX mapping and meaning in Signals before deploying.",
      );
    });
  }
  function toggle(key: string, checked: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  return (
    <Modal
      title={onDocument ? "Add Modbus device" : "Add from Modbus scan"}
      description="Discover readable addresses and raw values. Names, units, scale and write permissions remain unknown until identified."
      width={1140}
      scrollable
      closeLabel="Close"
      onClose={onClose}
      ctaLabel={job ? `Add selected (${selected.size})` : "Start scan"}
      ctaDisabled={busy || (job ? !canImport : !!problem || active)}
      onConfirm={() => void (job ? addSelected() : start())}
      foot={
        active
          ? "The server keeps running if this window closes. Use Cancel scan to stop and restore."
          : "Results are added to the local draft only. No automatic deployment."
      }
    >
      <div className="space-y-4 text-sm">
        {onDocument && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="max-w-2xl text-xs text-fg-muted">
              Exploration without documentation finds readable addresses and
              candidate encodings. Register meanings and access remain unknown.
            </p>
            <Button size="sm" variant="secondary" onClick={onDocument}>
              Use a PDF map
            </Button>
          </div>
        )}
        {error && (
          <p
            role="alert"
            className="rounded border border-error/30 bg-error-bg p-3 text-error"
          >
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded border border-border p-3">
            {notice}
          </p>
        )}
        {jobs.length > 0 && (
          <Field label="Saved scans" htmlFor="scan-history">
            <Select
              id="scan-history"
              className="w-[480px] max-w-full"
              value={job?.id ?? ""}
              options={[
                { value: "", label: "New scan" },
                ...jobs.map((candidate) => ({
                  value: candidate.id,
                  label: `${new Date(candidate.createdAt).toLocaleString()} · ${candidate.host} · slave ${candidate.input.slave} · ${stateLabels[candidate.state]}`,
                })),
              ]}
              onValueChange={(value) => {
                setJob(
                  jobs.find((candidate) => candidate.id === value) ?? null,
                );
                setSelected(new Set());
                setPage(0);
                setNotice(null);
              }}
            />
          </Field>
        )}
        {!job && (
          <>
            <div className="flex flex-wrap items-start gap-4">
              <Field label="Connection" htmlFor="scan-connection">
                <Select
                  id="scan-connection"
                  className="w-[240px]"
                  value={`${locator.kind}:${locator.nodeIndex}`}
                  options={nodes.map((node) => ({
                    value: `${node.locator.kind}:${node.locator.nodeIndex}`,
                    label: node.label,
                  }))}
                  onValueChange={(value) => {
                    const [kind, nodeIndex] = value.split(":");
                    setLocator({
                      kind: kind as "rtu" | "tcp",
                      nodeIndex: Number(nodeIndex),
                    });
                  }}
                />
              </Field>
              <Field label="Slave / unit ID" htmlFor="scan-slave">
                <Input
                  id="scan-slave"
                  aria-invalid={invalid.slave}
                  style={{ width: 110 }}
                  type="number"
                  min={1}
                  max={247}
                  value={slave}
                  onChange={(event) => setSlave(Number(event.target.value))}
                />
              </Field>
              <Field label="Address display base" htmlFor="scan-base">
                <Select
                  id="scan-base"
                  className="w-[160px]"
                  value={base}
                  options={[
                    { value: "0", label: "Base 0 (PDU)" },
                    { value: "1", label: "Base 1" },
                  ]}
                  onValueChange={(value) => setBase(Number(value) as 0 | 1)}
                />
              </Field>
            </div>
            <fieldset className="space-y-2">
              <legend className="mb-2 font-medium">
                Functions and address ranges
              </legend>
              <div className="grid grid-cols-[220px_110px_110px] items-center gap-x-3 gap-y-2">
                <span className="font-mono text-[10.5px] font-medium uppercase tracking-wider text-fg-muted">
                  Function
                </span>
                <span className="font-mono text-[10.5px] font-medium uppercase tracking-wider text-fg-muted">
                  Start
                </span>
                <span className="font-mono text-[10.5px] font-medium uppercase tracking-wider text-fg-muted">
                  End
                </span>
                {ranges.map((range, index) => (
                  <React.Fragment key={range.function}>
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={range.enabled}
                        onChange={(event) =>
                          setRanges((previous) =>
                            previous.map((row, i) =>
                              i === index
                                ? { ...row, enabled: event.target.checked }
                                : row,
                            ),
                          )
                        }
                      />
                      FC0{range.function} ·{" "}
                      {SCAN_FUNCTION_LABELS[range.function]}
                    </label>
                    <Input
                      type="number"
                      aria-label={`FC0${range.function} start address`}
                      min={base}
                      max={65535 + base}
                      disabled={!range.enabled}
                      aria-invalid={
                        range.enabled && invalidAddress(range.start)
                      }
                      value={range.start + base}
                      onChange={(event) =>
                        setRanges((previous) =>
                          previous.map((row, i) =>
                            i === index
                              ? {
                                  ...row,
                                  start: Number(event.target.value) - base,
                                }
                              : row,
                          ),
                        )
                      }
                    />
                    <Input
                      type="number"
                      aria-label={`FC0${range.function} end address`}
                      min={base}
                      max={65535 + base}
                      disabled={!range.enabled}
                      aria-invalid={range.enabled && invalidAddress(range.end)}
                      value={range.end + base}
                      onChange={(event) =>
                        setRanges((previous) =>
                          previous.map((row, i) =>
                            i === index
                              ? {
                                  ...row,
                                  end: Number(event.target.value) - base,
                                }
                              : row,
                          ),
                        )
                      }
                    />
                  </React.Fragment>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap items-start gap-4">
              <Field label="Points per batch" htmlFor="scan-batch">
                <Input
                  id="scan-batch"
                  aria-invalid={invalid.batch}
                  style={{ width: 130 }}
                  type="number"
                  min={1}
                  max={512}
                  value={batchSize}
                  onChange={(event) => setBatchSize(Number(event.target.value))}
                />
              </Field>
              <Field label="Total point limit" htmlFor="scan-limit">
                <Input
                  id="scan-limit"
                  aria-invalid={invalid.limit}
                  style={{ width: 130 }}
                  type="number"
                  min={1}
                  max={4096}
                  value={maxPoints}
                  onChange={(event) => setMaxPoints(Number(event.target.value))}
                />
              </Field>
              <Field label="Maximum scan time" htmlFor="scan-time">
                <Input
                  id="scan-time"
                  aria-invalid={invalid.time}
                  style={{ width: 130 }}
                  unit="s"
                  type="number"
                  min={30}
                  max={1800}
                  value={maxSeconds}
                  onChange={(event) =>
                    setMaxSeconds(Number(event.target.value))
                  }
                />
              </Field>
            </div>
            {estimate && (
              <p role="status">
                {estimate.points} function/address pairs · at least{" "}
                {estimate.minimumReads} reads · {estimate.batches} batches.
                Estimated {Math.ceil(estimate.seconds / 60)} min, including RTU
                transfers and restoration. Timeouts can take longer; restoration
                continues beyond the scan time limit.
              </p>
            )}
            {estimate && estimate.seconds > maxSeconds && (
              <p className="text-fg-muted">
                The estimated scan exceeds the time limit. Some addresses may
                remain unconfirmed.
              </p>
            )}
            <p
              className={
                locator.kind === "rtu"
                  ? "rounded border border-warning-border bg-warning-bg p-3 text-warning-text"
                  : "rounded border border-[#C9DEF0] bg-[#EAF3FB] p-3 text-hms-accent"
              }
            >
              {locator.kind === "rtu"
                ? "RTU scanning temporarily changes the live gateway configuration and may interrupt or slow operation. The scan takes over the control connection. The original project is backed up and restored before results can be added; reconnect in Connection afterward."
                : "TCP scanning reads the slave directly from this server. The gateway configuration is unchanged."}
            </p>
            {problem && (
              <p
                className={
                  Object.values(invalid).some(Boolean) ||
                  input.ranges.some(
                    (range) =>
                      invalidAddress(range.start) || invalidAddress(range.end),
                  )
                    ? "text-error"
                    : "text-fg-muted"
                }
              >
                {problem}
              </p>
            )}
          </>
        )}
        {job && (
          <>
            <div
              className="rounded border border-border p-3"
              aria-live="polite"
            >
              <p className="font-medium">
                {stateLabels[job.state]} · {job.host} · slave {job.input.slave}
              </p>
              <p>
                Two observations per point · batch {job.batch}/{job.batches}
              </p>
              <div className="mt-2">
                <ProgressBar
                  value={job.processed}
                  max={job.points}
                  label="Scan progress"
                  caption={`${job.processed} / ${job.points} points`}
                />
              </div>
              {job.cancelRequested && active && (
                <p>
                  Cancellation requested. The current transfer will finish
                  before restoration.
                </p>
              )}
              {job.backupHash && (
                <p className="mt-2 break-all font-mono text-xs">
                  Backup SHA-256: {job.backupHash}
                </p>
              )}
              {job.restoredHash && (
                <p className="mt-1 text-xs">
                  Original gateway project restored and checksum verified.
                </p>
              )}
              {job.error && <p className="mt-2 text-error">{job.error}</p>}
              {job.recoveryError && (
                <p role="alert" className="mt-2 text-error">
                  {job.recoveryError}
                </p>
              )}
              {active &&
                job.state !== "restoring" &&
                job.state !== "restore-pending" && (
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="secondary"
                    disabled={busy || job.cancelRequested}
                    onClick={() => void cancel()}
                  >
                    Cancel scan
                  </Button>
                )}
              {job.state === "restore-pending" && (
                <div className="mt-3 space-y-2">
                  <p>
                    Deployments to this gateway are blocked until the backup is
                    restored.
                  </p>
                  {session?.host !== job.host && (
                    <Field
                      label="Gateway password"
                      htmlFor="scan-recovery-password"
                    >
                      <Input
                        id="scan-recovery-password"
                        type="password"
                        autoComplete="off"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                    </Field>
                  )}
                  <Button
                    size="sm"
                    disabled={busy || (session?.host !== job.host && !password)}
                    onClick={() => void restore()}
                  >
                    Restore backup
                  </Button>
                </div>
              )}
            </div>
            {job.input.projectId !== projectId && (
              <p>
                These results belong to another project.{" "}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setProjectId(job.input.projectId)}
                >
                  Open scanned project
                </Button>
              </p>
            )}
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2">
                <Switch
                  aria-label="Hide constant zeros"
                  checked={hideZero}
                  onCheckedChange={(checked) => {
                    setHideZero(checked);
                    setPage(0);
                  }}
                />
                Hide constant zeros
              </label>
              <label className="flex items-center gap-2">
                <Switch
                  aria-label="Hide FC04 when equal to FC03"
                  checked={hideFc4}
                  onCheckedChange={(checked) => {
                    setHideFc4(checked);
                    setPage(0);
                  }}
                />
                Hide FC04 when equal to FC03
              </label>
              <label className="flex items-center gap-2">
                <Switch
                  aria-label="Only changes"
                  checked={onlyChanges}
                  onCheckedChange={(checked) => {
                    setOnlyChanges(checked);
                    setPage(0);
                  }}
                />
                Only changes
              </label>
              <label className="flex items-center gap-2">
                Base{" "}
                <Select
                  size="sm"
                  aria-label="Result address display base"
                  className="w-16"
                  value={base}
                  options={[
                    { value: "0", label: "0" },
                    { value: "1", label: "1" },
                  ]}
                  onValueChange={(value) => setBase(Number(value) as 0 | 1)}
                />
              </label>
            </div>
            <p className="text-xs text-fg-muted">
              A readable address is not an identified signal. Bit / uint16 raw
              defaults are used when adding; Modbus writing stays disabled.
              Matching FC03/04 values remain separate results.
            </p>
            <Table className="text-xs">
              <TableHeader>
                <tr>
                  <TableHead className="w-8">
                    <Checkbox
                      aria-label="Select readable results on this page"
                      checked={
                        visible.some((row) => row.samples) &&
                        visible
                          .filter((row) => row.samples)
                          .every((row) => selected.has(pointKey(row)))
                      }
                      onChange={(event) =>
                        setSelected((previous) => {
                          const next = new Set(previous);
                          for (const row of visible.filter(
                            (row) => row.samples,
                          ))
                            if (event.target.checked) next.add(pointKey(row));
                            else next.delete(pointKey(row));
                          return next;
                        })
                      }
                    />
                  </TableHead>
                  <TableHead>FC</TableHead>
                  <TableHead>Address (base {base})</TableHead>
                  <TableHead>Raw</TableHead>
                  <TableHead>Observations</TableHead>
                  <TableHead>Interpretations · candidates</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {visible.map((row) => {
                  const next = job.results.find(
                    (other) =>
                      other.function === row.function &&
                      other.address === row.address + 1,
                  );
                  return (
                    <TableRow key={pointKey(row)}>
                      <TableCell>
                        <Checkbox
                          aria-label={`Select FC0${row.function} PDU ${row.address}`}
                          checked={selected.has(pointKey(row))}
                          disabled={!row.samples}
                          onChange={(event) =>
                            toggle(pointKey(row), event.target.checked)
                          }
                        />
                      </TableCell>
                      <TableCell className="font-mono">
                        0{row.function}
                      </TableCell>
                      <TableCell className="font-mono">
                        {row.address + base}
                      </TableCell>
                      <TableCell className="font-mono">
                        {row.lastValue === undefined
                          ? "—"
                          : `${row.lastValue} (0x${row.lastValue.toString(16).padStart(row.function <= 2 ? 1 : 4, "0")})`}
                      </TableCell>
                      <TableCell>
                        {row.status} · {row.samples} reads
                        {row.changed
                          ? " · changes"
                          : row.samples >= 2
                            ? " · constant"
                            : ""}
                        {row.exceptionCodes.length
                          ? ` · exception ${row.exceptionCodes.join(", ")}`
                          : ""}
                        {row.timeouts ? ` · ${row.timeouts} timeouts` : ""}
                      </TableCell>
                      <TableCell className="max-w-[350px]">
                        {interpretations(row).join("; ")}
                        {row.function >= 3 &&
                          row.lastValue !== undefined &&
                          next?.lastValue !== undefined && (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-fg-muted">
                                Float32 with next word (boundary unconfirmed)
                              </summary>
                              {floatInterpretations(
                                row.lastValue,
                                next.lastValue,
                              ).join("; ")}
                            </details>
                          )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {!filtered.length && <p>No results match these filters.</p>}
            <div className="flex items-center justify-between">
              <p>
                {filtered.length} shown · {selected.size} selected · page{" "}
                {currentPage + 1}/
                {Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={(currentPage + 1) * PAGE_SIZE >= filtered.length}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
