"use client";
import * as React from "react";
import { ApiError, request } from "@/lib/api";
import { useCurrentProject } from "@/lib/current-project";
import { useGatewaySession } from "@/lib/gateway-session";
import { usePropertyDrafts } from "@/lib/property-drafts";
import type { NodeLocator, ProjectView } from "@/lib/project-types";
import {
  DEFAULT_AI_SETTINGS,
  MAX_AUTOMATIC_ANALYSES,
  extractionResumePlan,
  type AISettings,
  type AIProvider,
  type CandidateSignal,
  type ModbusAIJob,
  type ValidationResult,
} from "@/core/modbus-ai/model";
import { isScanTerminal, type ScanJob } from "@/core/modbus-scan/model";
import { validationTargets } from "@/core/modbus-ai/validation";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { ModbusScanModal } from "./modbus-scan-modal";
import { ArrowRight, Check, ChevronDown, Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DocumentStep,
  WizardHeader,
  SignalEditor,
  StatusBadge,
  liveResult,
  tableHeading,
  tableCell,
  type WizardStep,
} from "./modbus-ai-wizard-parts";

type Report = {
  job: ModbusAIJob;
  scan?: ScanJob;
  validation: ValidationResult[];
  scope: string;
  liveStatus?: "not-validated-live" | "live-evidence-collected";
};
type SettingsResponse = {
  settings: AISettings;
  available: Record<AIProvider, boolean>;
};
const taskLabels = {
  extraction: "PDF extraction",
  diagnosis: "Live diagnosis",
  review: "Review with AI",
};

function guidedBaseline(report: Report | null, signalId: string) {
  const run = report?.job.runs.find(
    (candidate) =>
      candidate.scanId === report.scan?.id &&
      candidate.revision === report.job.revision,
  );
  const value = report?.validation.find(
    (candidate) => candidate.signalId === signalId,
  );
  return run?.signalIds.includes(signalId) &&
    value?.lastAt &&
    value.lastAt >= run.startedAt &&
    typeof value.lastValue === "number"
    ? String(value.lastValue)
    : undefined;
}

export function ModbusAIModal({
  initialLocator,
  onClose,
  onExplore,
  initialJobId,
  onJobSelected,
}: {
  initialLocator: NodeLocator;
  onClose: () => void;
  onExplore?: () => void;
  initialJobId?: string;
  onJobSelected?: (id?: string) => void;
}) {
  const { view, projectId, acceptView, mutating } = useCurrentProject();
  const { session } = useGatewaySession();
  const drafts = usePropertyDrafts();
  const [settings, setSettings] = React.useState(DEFAULT_AI_SETTINGS);
  const [available, setAvailable] = React.useState<Record<AIProvider, boolean>>(
    { openai: false, anthropic: false, kimi: false },
  );
  const [jobs, setJobs] = React.useState<ModbusAIJob[]>([]);
  const [report, setReport] = React.useState<Report | null>(null);
  const [draftRows, setDraftRows] = React.useState<CandidateSignal[] | null>(
    null,
  );
  const [requestedStep, setStep] = React.useState<WizardStep>(
    initialJobId ? "Map" : "Document",
  );
  const [file, setFile] = React.useState<File | null>(null);
  const [locator, setLocator] = React.useState(initialLocator);
  const [slave, setSlave] = React.useState(1);
  const [seconds, setSeconds] = React.useState(60);
  const [batchSize, setBatchSize] = React.useState(128);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [requestedPage, setPage] = React.useState(0);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [autoDiagnosis, setAutoDiagnosis] = React.useState(false);
  const [experimentSignal, setExperimentSignal] = React.useState("");
  const [before, setBefore] = React.useState("");
  const [after, setAfter] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [changeAt, setChangeAt] = React.useState("");
  const [restoreOpen, setRestoreOpen] = React.useState(false);
  const [settingsLoaded, setSettingsLoaded] = React.useState(false);
  const [useCurrentSettings, setUseCurrentSettings] = React.useState(true);
  const [filter, setFilter] = React.useState<
    "all" | "review" | "warnings" | "excluded"
  >("all");
  const [query, setQuery] = React.useState("");
  const [skipLive, setSkipLive] = React.useState(false);
  const [confirmClose, setConfirmClose] = React.useState(false);
  const [dismissed, setDismissed] = React.useState<Set<string>>(new Set());
  const [imported, setImported] = React.useState(false);
  const previousState = React.useRef<ModbusAIJob["state"] | undefined>(
    undefined,
  );
  const selectedJob = React.useRef<string | null>(null);
  const selectedGuidedSignal = React.useRef("");
  const pollBusy = React.useRef(false);
  const job = report?.job.projectId === projectId ? report.job : undefined;
  const step = job && job.state !== "ready" ? "Document" : requestedStep;
  const scan = job ? report?.scan : undefined;
  const rows = draftRows ?? job?.signals ?? [];
  const active = Boolean(scan && !isScanTerminal(scan.state));
  const aiBusy = Boolean(job?.busy || job?.state === "extracting");
  const hasProjectEdits =
    Object.keys(drafts.snapshot.projects[projectId ?? ""]?.edits ?? {}).length >
    0;
  const selected = rows.filter((r) => r.enabled);
  const canEdit = !busy && !active && !aiBusy;
  const nodes =
    view?.family === "knx-mbm"
      ? [
          ...view.project.mbm.rtuNodes.map((n, nodeIndex) => ({
            locator: { kind: "rtu" as const, nodeIndex },
            label: `RTU node ${nodeIndex + 1} — Port ${n.physicalPort === 0 ? "A" : "B"}`,
          })),
          ...view.project.mbm.tcpNodes.map((n, nodeIndex) => ({
            locator: { kind: "tcp" as const, nodeIndex },
            label: `TCP node ${nodeIndex + 1} — ${n.ip}:${n.port}`,
          })),
        ]
      : [];

  React.useEffect(() => {
    let disposed = false;
    selectedJob.current = initialJobId ?? null;
    void request<SettingsResponse>("/api/modbus-ai/settings")
      .then((result) => {
        if (!disposed) {
          setSettings(result.settings);
          setAvailable(result.available);
          setSettingsLoaded(true);
        }
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    const refreshSettings = () => {
      void request<SettingsResponse>("/api/modbus-ai/settings")
        .then((result) => {
          if (!disposed) {
            setSettings(result.settings);
            setAvailable(result.available);
            setSettingsLoaded(true);
          }
        })
        .catch((e) => {
          if (!disposed) setError(e.message);
        });
    };
    window.addEventListener("focus", refreshSettings);
    const poll = async () => {
      if (pollBusy.current || !projectId) return;
      pollBusy.current = true;
      try {
        const next = await request<{ jobs: ModbusAIJob[] }>(
          `/api/modbus-ai/jobs?projectId=${encodeURIComponent(projectId)}`,
        );
        if (disposed) return;
        setJobs(next.jobs);
        const id = selectedJob.current;
        if (id) {
          const result = await request<Report>(`/api/modbus-ai/jobs/${id}`);
          if (!disposed && selectedJob.current === id) {
            if (
              result.job.state === "ready" &&
              previousState.current === "extracting"
            )
              setStep("Map");
            previousState.current = result.job.state;
            const baseline = guidedBaseline(
              result,
              selectedGuidedSignal.current,
            );
            if (baseline !== undefined) setBefore((old) => old || baseline);
            setReport((old) =>
              old?.job.id === id && old.job.revision > result.job.revision
                ? old
                : result,
            );
          }
        }
      } catch (e) {
        if (!disposed)
          setError(
            e instanceof Error ? e.message : "Could not load document maps",
          );
      } finally {
        pollBusy.current = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshSettings);
    };
  }, [projectId, initialJobId]);

  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  }
  async function load(id: string) {
    selectedJob.current = id;
    setDraftRows(null);
    setEditing(null);
    setPage(0);
    const next = await request<Report>(`/api/modbus-ai/jobs/${id}`);
    if (next.job.projectId !== projectId)
      throw new Error("This map belongs to a different project.");
    setReport(next);
    previousState.current = next.job.state;
    setUseCurrentSettings(false);
    onJobSelected?.(id);
    setImported(false);
    return next;
  }
  async function upload() {
    if (!file || !projectId) return;
    await action(async () => {
      const form = new FormData();
      form.append("projectId", projectId);
      form.append("file", file);
      const next = await request<{ job: ModbusAIJob }>("/api/modbus-ai/jobs", {
        method: "POST",
        body: form,
      });
      await load(next.job.id);
      setStep("Document");
    });
  }
  function patchRow(id: string, patch: Partial<CandidateSignal>) {
    setDraftRows(
      rows.map((row) =>
        row.id === id
          ? { ...row, ...patch, reviewed: patch.reviewed ?? false }
          : row,
      ),
    );
  }
  function addManualRow() {
    const row: CandidateSignal = {
      id: crypto.randomUUID(),
      name: "New signal",
      description: "",
      function: 3,
      address: 0,
      sourceAddress: "manual",
      addressBasis: "explicit",
      dataType: "uint16",
      byteOrder: null,
      bit: null,
      scale: null,
      offset: null,
      unit: null,
      access: "unknown",
      min: null,
      max: null,
      enumValues: [],
      sentinels: [],
      sourcePages: [],
      sourceQuote: "",
      applicableModels: [],
      warnings: [
        "Manually added; verify its address, encoding and source before import.",
      ],
      reviewed: false,
      enabled: true,
    };
    setDraftRows([...rows, row]);
    setEditing(row.id);
    setPage(Math.floor(rows.length / 40));
  }
  async function saveMap() {
    if (!job || !draftRows) return;
    const next = await request<{ job: ModbusAIJob }>(
      `/api/modbus-ai/jobs/${job.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: job.revision, signals: draftRows }),
      },
    );
    setDraftRows(null);
    setReport((old) => (old ? { ...old, job: next.job, validation: [] } : old));
  }
  let targetProblem: string | undefined;
  if (hasProjectEdits || mutating)
    targetProblem = "Save project edits before capturing or importing.";
  else if (!Number.isInteger(slave) || slave < 1 || slave > 247)
    targetProblem = "Choose slave 1–247.";
  else if (
    !nodes.some(
      (n) =>
        n.locator.kind === locator.kind &&
        n.locator.nodeIndex === locator.nodeIndex,
    )
  )
    targetProblem = "Choose an existing connection.";
  else if (
    locator.kind === "rtu" &&
    (!session?.connected || session.gateway?.appId !== 4)
  )
    targetProblem = "Connect to a KNX–MBM gateway in Connection.";
  else if (locator.kind === "rtu" && (session?.busy || session?.monitoring))
    targetProblem = "Stop gateway diagnostics monitoring before capture.";
  let targets = 0;
  try {
    targets = validationTargets(rows).length;
  } catch (e) {
    targetProblem = e instanceof Error ? e.message : "Invalid targets";
  }
  const startCapture = async () => {
    if (!job || draftRows) return;
    await action(async () => {
      const result = await request<{ job: ModbusAIJob; scan: ScanJob }>(
        `/api/modbus-ai/jobs/${job.id}/validate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            revision: job.revision,
            input: {
              locator,
              slave,
              sessionId: session?.id,
              batchSize,
              maxPoints: 4096,
              maxDurationSeconds: 600,
              observationSeconds: seconds,
            },
          }),
        },
      );
      setReport({
        job: result.job,
        scan: result.scan,
        validation: [],
        scope: report!.scope,
      });
      setBefore("");
      setAfter("");
      setChangeAt("");
    });
  };
  async function analyze(task: "diagnosis" | "review") {
    if (!job || draftRows) return;
    const next = await request<{ job: ModbusAIJob }>(
      `/api/modbus-ai/jobs/${job.id}/analyze`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: job.revision, task }),
      },
    );
    setReport((old) => (old ? { ...old, job: next.job } : old));
  }
  const diagnosisJobId = job?.id;
  const diagnosisRevision = job?.revision;
  const diagnosisBusy = job?.busy;
  const diagnosisCount = job?.analyses.length;
  const captureState = scan?.state;
  const automaticAttempts = job?.automaticAttempts?.[scan?.id ?? ""] ?? 0;
  // Only one request per window; server rate limiting also protects retries.
  React.useEffect(() => {
    if (
      !autoDiagnosis ||
      captureState !== "scanning" ||
      !diagnosisJobId ||
      diagnosisBusy ||
      automaticAttempts >= MAX_AUTOMATIC_ANALYSES ||
      draftRows ||
      !available[settings.diagnosis.provider]
    )
      return;
    const timer = window.setTimeout(() => {
      void request<{ job: ModbusAIJob }>(
        `/api/modbus-ai/jobs/${diagnosisJobId}/analyze`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            revision: diagnosisRevision,
            task: "diagnosis",
            automatic: true,
          }),
        },
      ).catch((e) => {
        if (!(e instanceof ApiError && [409, 429].includes(e.status))) {
          setError(e.message);
          setAutoDiagnosis(false);
        }
      });
    }, 10000);
    return () => window.clearTimeout(timer);
  }, [
    autoDiagnosis,
    captureState,
    diagnosisJobId,
    diagnosisRevision,
    diagnosisBusy,
    diagnosisCount,
    automaticAttempts,
    draftRows,
    available,
    settings.diagnosis.provider,
  ]);

  async function recordExperiment(at = changeAt || new Date().toISOString()) {
    if (!job) return;
    await action(async () => {
      await request(`/api/modbus-ai/jobs/${job.id}/experiments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: job.revision,
          experiment: {
            signalId: experimentSignal,
            at,
            before: Number(before),
            after: Number(after),
            description:
              description ||
              `Changed ${rows.find((row) => row.id === experimentSignal)?.name ?? "signal"} from ${before} to ${after}`,
            tolerance: 0.1,
          },
        }),
      });
      await load(job.id);
      setChangeAt(at);
      setEditing(experimentSignal);
      setNotice(
        "Recorded the external change. Keep capture running for the after sample.",
      );
    });
  }
  async function importMap() {
    if (!job || !view || draftRows) return;
    await action(async () => {
      const next = await request<ProjectView>(
        `/api/modbus-ai/jobs/${job.id}/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            revision: job.revision,
            projectRevision: view.meta.revision ?? 0,
            selected: selected.map((r) => r.id),
            target: { ...locator, slave },
          }),
        },
      );
      acceptView?.(next);
      setImported(true);
      setNotice(
        `Added ${selected.length} reviewed signals to the project. ${report?.liveStatus === "live-evidence-collected" ? "Live evidence is available in this map's report." : "Not validated live."}`,
      );
    });
  }

  const editRow = rows.find((row) => row.id === editing);
  const validationById = new Map(
    report?.validation.map((result) => [result.signalId, result]),
  );
  const lastAnalysis = job?.analyses
    .filter((analysis) => analysis.revision === job.revision)
    .at(-1);
  const ready = job?.state === "ready";
  const nodeLabel =
    nodes.find(
      (node) =>
        node.locator.kind === locator.kind &&
        node.locator.nodeIndex === locator.nodeIndex,
    )?.label ?? "Choose a Modbus node";
  const mapName =
    [job?.manufacturer, job?.model].filter(Boolean).join(" ") || "Document map";
  const hasLiveEvidence = Boolean(
    report?.validation.some((result) => result.samples > 0),
  );
  const canImport = Boolean(
    ready &&
      !busy &&
      !aiBusy &&
      !active &&
      !scan?.needsRestore &&
      !draftRows &&
      selected.length &&
      selected.every((row) => row.reviewed && !row.addressNeedsConfirmation) &&
      Number.isInteger(slave) &&
      slave >= 1 &&
      slave <= 247 &&
      nodes.some(
        (node) =>
          node.locator.kind === locator.kind &&
          node.locator.nodeIndex === locator.nodeIndex,
      ) &&
      !hasProjectEdits &&
      !mutating,
  );
  const filtered = rows.filter((row) => {
    if (filter === "review" && (!row.enabled || row.reviewed)) return false;
    if (filter === "warnings" && !row.warnings.length) return false;
    if (filter === "excluded" && row.enabled) return false;
    return (
      !query ||
      [row.name, row.sourceAddress, row.address, ...row.applicableModels]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase())
    );
  });
  const pages = Math.max(1, Math.ceil(filtered.length / 40));
  const page = Math.min(requestedPage, pages - 1);
  const shown = filtered.slice(page * 40, page * 40 + 40);
  const guidedRow = rows.find((row) => row.id === experimentSignal);
  const guidedResult = validationById.get(experimentSignal);
  const currentRun = job?.runs.find(
    (run) => run.scanId === scan?.id && run.revision === job.revision,
  );
  const hasBaseline = Boolean(
    currentRun?.signalIds.includes(experimentSignal) &&
      guidedResult?.lastAt &&
      guidedResult.lastAt >= currentRun.startedAt &&
      typeof guidedResult.lastValue === "number",
  );
  const guidedExperiment = job?.experiments
    .filter(
      (test) =>
        test.signalId === experimentSignal &&
        test.scanId === scan?.id &&
        test.revision === job.revision,
    )
    .at(-1);
  const guidedMatches =
    guidedResult?.checks.meaning.state === "supported" &&
    guidedResult.checks.scale.state === "supported";
  const liveRows = selected;
  const importStates = selected.map((row) =>
    liveResult(row, validationById.get(row.id), scan),
  );
  const validatedCount = importStates.filter(
    (result) => result.label === "Live-validated",
  ).length;
  const readCount = importStates.filter(
    (result) => result.label === "Read OK",
  ).length;
  const inactiveCount = selected.filter(
    (row) => row.access === "W" || row.access === "Trigger",
  ).length;
  const importProblem = draftRows
    ? "Save map changes before importing."
    : scan?.needsRestore
      ? "Gateway restoration must finish before importing."
      : active
        ? "Wait for the live check to finish, or stop it to restore the gateway."
        : hasProjectEdits || mutating
          ? "Save project edits before importing."
          : !selected.length
            ? "Include at least one signal in the map."
            : selected.some((row) => !row.reviewed)
              ? `Review the ${selected.filter((row) => !row.reviewed).length} included signals still pending in Map.`
              : !Number.isInteger(slave) || slave < 1 || slave > 247
                ? "Choose a slave ID from 1 to 247."
                : !nodes.some(
                      (node) =>
                        node.locator.kind === locator.kind &&
                        node.locator.nodeIndex === locator.nodeIndex,
                    )
                  ? "Choose an existing destination node."
                  : undefined;

  function closeWizard() {
    if (confirmClose || restoreOpen) return;
    if (draftRows) setConfirmClose(true);
    else onClose();
  }
  function chooseFile(picked: File) {
    if (
      !/\.pdf$/i.test(picked.name) ||
      (picked.type && picked.type !== "application/pdf")
    ) {
      setError("Choose a PDF document.");
      return;
    }
    if (picked.size > 20 * 1024 * 1024) {
      setError("The PDF must be 20 MB or smaller.");
      return;
    }
    selectedJob.current = null;
    setReport(null);
    onJobSelected?.(undefined);
    setFile(picked);
    setError(null);
    setNotice(null);
    setImported(false);
    setSkipLive(false);
    setStep("Document");
  }
  async function openRecent(id: string) {
    await action(async () => {
      const next = await load(id);
      setFile(null);
      setSkipLive(false);
      setNotice(null);
      setError(null);
      setStep(next.job.state === "ready" ? "Map" : "Document");
    });
  }
  async function resume() {
    if (!job) return;
    await action(async () => {
      const next = await request<{ job: ModbusAIJob }>(
        `/api/modbus-ai/jobs/${job.id}/resume`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: job.revision, useCurrentSettings }),
        },
      );
      setReport((old) => (old ? { ...old, job: next.job } : old));
      previousState.current = next.job.state;
    });
  }
  function chooseGuidedSignal(id: string) {
    selectedGuidedSignal.current = id;
    setExperimentSignal(id);
    if (id) setEditing(id);
    setBefore(guidedBaseline(report, id) ?? "");
    setAfter("");
    setDescription("");
    setChangeAt("");
  }
  function navigateStep(next: WizardStep) {
    if (next === "Live check") {
      setSkipLive(false);
      const row = rows.find((candidate) => candidate.id === editing);
      if (
        row?.enabled &&
        row.access !== "W" &&
        row.access !== "Trigger" &&
        experimentSignal !== row.id
      )
        chooseGuidedSignal(row.id);
    }
    setStep(next);
  }
  function selectRow(row: CandidateSignal) {
    setEditing(row.id);
    if (
      step === "Live check" &&
      row.enabled &&
      row.access !== "W" &&
      row.access !== "Trigger" &&
      experimentSignal !== row.id
    )
      chooseGuidedSignal(row.id);
  }
  function goToImport() {
    setSkipLive(!hasLiveEvidence);
    setStep("Import");
  }
  const correctionRows = (row: CandidateSignal) => {
    if (!lastAnalysis) return null;
    return lastAnalysis.corrections.map((proposal, index) => {
      const key = `${lastAnalysis.id}:${index}`;
      if (proposal.signalId !== row.id || dismissed.has(key)) return null;
      return (
        <div
          key={key}
          className="flex flex-wrap items-start gap-2 px-3 py-2 text-[11.5px] leading-relaxed"
        >
          <span className="mt-0.5 rounded border border-info-border px-1 font-mono text-[10px] text-hms-accent">
            AI
          </span>
          <p className="min-w-[180px] flex-1">
            <strong>
              {proposal.field} → {proposal.value}.
            </strong>{" "}
            <span className="text-fg-muted">{proposal.reason}</span>
          </p>
          <Button
            size="sm"
            className="h-6 px-2"
            disabled={!canEdit || Boolean(draftRows)}
            onClick={() =>
              void action(async () => {
                await request(`/api/modbus-ai/jobs/${job!.id}/corrections`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    revision: job!.revision,
                    analysisId: lastAnalysis.id,
                    index,
                  }),
                });
                await load(job!.id);
                setEditing(row.id);
                setNotice(
                  "Correction saved. Review the changed signal before importing.",
                );
              })
            }
          >
            Accept
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-6 px-2"
            onClick={() => setDismissed((old) => new Set([...old, key]))}
          >
            Dismiss
          </Button>
        </div>
      );
    });
  };
  const hasCorrections = (row: CandidateSignal) =>
    Boolean(
      lastAnalysis?.corrections.some(
        (proposal, index) =>
          proposal.signalId === row.id &&
          !dismissed.has(`${lastAnalysis.id}:${index}`),
      ),
    );
  const findings = (signalId: string | null) =>
    lastAnalysis?.findings
      .filter((finding) => finding.signalId === signalId)
      .map((finding, index) => (
        <details key={index} className="text-[11.5px] leading-relaxed">
          <summary className="cursor-pointer">{finding.claim}</summary>
          <div className="mt-2 space-y-1 text-fg-muted">
            {finding.evidence.map((evidence, i) => (
              <p key={i}>{evidence}</p>
            ))}
            <p>
              {finding.confidence} confidence
              {finding.nextCheck ? ` · Next check: ${finding.nextCheck}` : ""}
            </p>
          </div>
        </details>
      ));
  const pagination = (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-card-foot px-4 py-2">
      <span className="text-[11px] text-fg-muted">
        {filtered.length ? page * 40 + 1 : 0}–
        {Math.min((page + 1) * 40, filtered.length)} of {filtered.length}{" "}
        signals
      </span>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </Button>
        <span className="font-mono text-[10px] text-fg-muted">
          {page + 1} / {pages}
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={page + 1 >= pages}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
  const destination = (
    <div className="flex min-w-0 flex-wrap items-end gap-3">
      <Field
        label="Node"
        htmlFor="ai-destination-node"
        className="min-w-[180px] flex-1"
      >
        <Select
          id="ai-destination-node"
          disabled={active || busy}
          value={`${locator.kind}:${locator.nodeIndex}`}
          options={nodes.map((node) => ({
            value: `${node.locator.kind}:${node.locator.nodeIndex}`,
            label: node.label,
          }))}
          onValueChange={(value) => {
            const [kind, index] = value.split(":");
            setLocator({
              kind: kind as NodeLocator["kind"],
              nodeIndex: Number(index),
            });
          }}
        />
      </Field>
      <Field label="Slave" htmlFor="ai-destination-slave" className="w-[76px]">
        <Input
          id="ai-destination-slave"
          className="font-mono"
          disabled={active || busy}
          type="number"
          min={1}
          max={247}
          value={slave}
          onChange={(event) => setSlave(Number(event.target.value))}
        />
      </Field>
    </div>
  );
  const guidedPanel = (
    <section className="space-y-3" aria-label="Guided test">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-bold text-hms-blue">Guided test</h3>
        {guidedExperiment && (
          <button
            type="button"
            className="text-[11px] font-semibold text-hms-accent hover:underline"
            onClick={() => {
              setAfter("");
              setChangeAt("");
              setDescription("");
            }}
          >
            Test another change
          </button>
        )}
      </div>
      <p className="text-[11.5px] leading-relaxed text-fg-muted">
        Change one value on the device and check that its reading follows.
      </p>
      <Field label="Signal" htmlFor="ai-guided-signal">
        <Select
          id="ai-guided-signal"
          value={experimentSignal}
          options={[
            { value: "", label: "Choose a signal…" },
            ...selected
              .filter((row) => row.access !== "W" && row.access !== "Trigger")
              .map((row) => ({ value: row.id, label: row.name })),
          ]}
          onValueChange={chooseGuidedSignal}
        />
      </Field>
      {guidedExperiment && (
        <div className="space-y-2 rounded border border-border bg-[#F6F8FA] p-3 text-[11px]">
          <p className="font-semibold">{guidedExperiment.description}</p>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-[10px] uppercase text-fg-muted">
                Before · expected
              </p>
              <p className="mt-1 font-mono text-[15px]">
                {guidedExperiment.before} {guidedRow?.unit}
              </p>
            </div>
            <ArrowRight size={16} aria-hidden className="text-fg-muted" />
            <div className="flex-1">
              <p className="text-[10px] uppercase text-fg-muted">
                Latest reading
              </p>
              <p className="mt-1 font-mono text-[15px] text-hms-blue">
                {guidedResult?.lastValue ?? "—"}{" "}
                {guidedResult?.lastValue !== undefined ? guidedRow?.unit : ""}
              </p>
            </div>
          </div>
          <p className="text-fg-muted">
            Expected after: {guidedExperiment.after} {guidedRow?.unit} · change
            recorded {new Date(guidedExperiment.at).toLocaleTimeString("en-GB")}
          </p>
          <StatusBadge
            tone={
              guidedMatches
                ? "success"
                : guidedResult?.checks.meaning.state === "contradicted"
                  ? "warning"
                  : "neutral"
            }
          >
            {guidedMatches
              ? "Matches the guided test"
              : guidedResult?.checks.meaning.state === "contradicted"
                ? "Conflicting test evidence"
                : "Waiting for comparison"}
          </StatusBadge>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Before" htmlFor="ai-guided-before">
          <Input
            id="ai-guided-before"
            type="number"
            step="any"
            value={before}
            onChange={(event) => setBefore(event.target.value)}
            className="font-mono"
          />
        </Field>
        <Field label="After" htmlFor="ai-guided-after">
          <Input
            id="ai-guided-after"
            type="number"
            step="any"
            value={after}
            onChange={(event) => setAfter(event.target.value)}
            className="font-mono"
          />
        </Field>
      </div>
      {!hasBaseline && (
        <p className="text-[11px] text-fg-muted">
          {active
            ? "Wait for a baseline reading of this signal."
            : "Start a live check to collect the before and after readings."}
        </p>
      )}
      <details className="text-[11px] text-fg-muted">
        <summary className="cursor-pointer">Test notes and time</summary>
        <div className="mt-2 space-y-2">
          <Field label="What changed" htmlFor="ai-guided-notes">
            <Input
              id="ai-guided-notes"
              value={description}
              placeholder="Optional note"
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <Field label="Change time (ISO)" htmlFor="ai-guided-time">
            <Input
              id="ai-guided-time"
              className="font-mono text-[11px]"
              value={changeAt}
              placeholder="Recorded when you click below"
              onChange={(event) => setChangeAt(event.target.value)}
            />
          </Field>
        </div>
      </details>
      <Button
        className="w-full"
        disabled={
          busy ||
          Boolean(draftRows) ||
          scan?.state !== "scanning" ||
          !hasBaseline ||
          !guidedRow ||
          before === "" ||
          after === "" ||
          !Number.isFinite(Number(before)) ||
          !Number.isFinite(Number(after)) ||
          Number(before) === Number(after)
        }
        onClick={() => void recordExperiment()}
      >
        I changed it now
      </Button>
      <p className="text-[10.5px] text-fg-muted">
        Click immediately after changing the device value.
      </p>
    </section>
  );
  const aiPanel = (
    <section
      className="space-y-3 border-t border-border pt-4"
      aria-label="AI analysis"
    >
      <h3 className="text-[13px] font-bold text-hms-blue">AI analysis</h3>
      <p className="text-[11.5px] leading-relaxed text-fg-muted">
        Checks the readings against the document and proposes corrections for
        your review.
      </p>
      <Button
        size="sm"
        variant="secondary"
        disabled={
          busy ||
          aiBusy ||
          Boolean(draftRows) ||
          !scan ||
          !available[settings.diagnosis.provider]
        }
        onClick={() => void action(() => analyze("diagnosis"))}
      >
        <Sparkles size={12} aria-hidden />
        {job?.busy === "diagnosis" ? "Analyzing…" : "Analyze with AI"}
      </Button>
      <label className="flex items-center gap-2 text-[11.5px]">
        <Checkbox
          checked={autoDiagnosis}
          disabled={
            !available[settings.diagnosis.provider] || Boolean(draftRows)
          }
          onChange={(event) => setAutoDiagnosis(event.target.checked)}
        />
        Analyze automatically
      </label>
      {autoDiagnosis && (
        <p className="text-[10.5px] text-fg-muted">
          {automaticAttempts} / {MAX_AUTOMATIC_ANALYSES} automatic analyses used
          for this capture.
        </p>
      )}
    </section>
  );
  const primaryLabel =
    step === "Document"
      ? job?.state === "failed"
        ? "Resume"
        : job?.state === "extracting"
          ? "Generating map…"
          : ready
            ? "Continue to map"
            : "Generate map"
      : step === "Map"
        ? draftRows
          ? "Save map changes"
          : "Continue to live check"
        : step === "Live check"
          ? "Continue to import"
          : imported
            ? "Done"
            : `Add ${selected.length} signals to project`;
  const primaryDisabled =
    step === "Document"
      ? busy ||
        (job?.state === "failed"
          ? !settingsLoaded ||
            !available[
              (useCurrentSettings ? settings.extraction : job.profile).provider
            ] ||
            extractionResumePlan(
              job,
              useCurrentSettings ? settings.extraction : job.profile,
            ) === "change-required"
          : job?.state === "extracting"
            ? true
            : ready
              ? false
              : !file ||
                !settingsLoaded ||
                !available[settings.extraction.provider])
      : step === "Map"
        ? !ready || busy || (draftRows ? !canEdit : !selected.length)
        : step === "Live check"
          ? busy || active || Boolean(scan?.needsRestore) || Boolean(draftRows)
          : !imported && !canImport;
  const primaryAction = () => {
    if (step === "Document") {
      if (job?.state === "failed") void resume();
      else if (ready) setStep("Map");
      else void upload();
    } else if (step === "Map") {
      if (draftRows) void action(saveMap);
      else navigateStep("Live check");
    } else if (step === "Live check") goToImport();
    else if (imported) onClose();
    else void importMap();
  };
  const footer = (
    <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-card-foot px-[22px] py-3">
      <p className="min-w-[150px] flex-1 text-[11px] leading-relaxed text-fg-muted">
        {step === "Document"
          ? job?.state === "extracting"
            ? "Progress is saved. Close to leave extraction running in the background."
            : job?.state === "failed"
              ? "Saved progress will be reused when you resume."
              : "Upload a manual or reopen a saved map."
          : step === "Map"
            ? draftRows
              ? "Unsaved changes. Save the map before continuing."
              : "Review the included signals before importing."
            : step === "Live check"
              ? "Read only. Write and Trigger access are not tested."
              : "Import changes the project draft."}
      </p>
      {step === "Import" && job && (
        <>
          {canImport ? (
            <a
              className="px-2 text-[11.5px] font-semibold text-hms-accent hover:underline"
              href={`/api/modbus-ai/jobs/${job.id}/export?format=template`}
            >
              Export .knxmbm template
            </a>
          ) : (
            <Button size="sm" variant="ghost" disabled>
              Export .knxmbm template
            </Button>
          )}
          <a
            className="px-2 text-[11.5px] font-semibold text-hms-accent hover:underline"
            href={`/api/modbus-ai/jobs/${job.id}/export`}
          >
            Download report (JSON)
          </a>
        </>
      )}
      <Button
        size="sm"
        variant="secondary"
        className="h-8"
        onClick={closeWizard}
      >
        Close
      </Button>
      {(step === "Map" || step === "Live check") && (
        <Button
          size="sm"
          variant="secondary"
          className="h-8"
          disabled={
            busy || active || Boolean(scan?.needsRestore) || Boolean(draftRows)
          }
          onClick={goToImport}
        >
          {step === "Map" ? "Skip to import" : "Skip live check"}
        </Button>
      )}
      <Button
        size="sm"
        className="h-8"
        disabled={primaryDisabled}
        onClick={primaryAction}
      >
        {primaryLabel}
      </Button>
    </footer>
  );
  return (
    <>
      <Modal
        title="Add Modbus device"
        width="min(1440px, 94vw)"
        height="90dvh"
        scrollable
        bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
        onClose={closeWizard}
        ctaLabel={primaryLabel}
        ctaDisabled={primaryDisabled}
        onConfirm={primaryAction}
        header={
          <WizardHeader
            step={step}
            job={job}
            node={nodeLabel}
            mapReviewed={
              selected.length > 0 && selected.every((row) => row.reviewed)
            }
            skipped={skipLive}
            onStep={(next) => {
              if (draftRows && next === "Document") {
                setError("Save map changes before returning to Document.");
                return;
              }
              navigateStep(next);
            }}
            onClose={closeWizard}
          />
        }
        footer={footer}
      >
        {(error || notice || job?.error || job?.busy) && (
          <div className="shrink-0 space-y-1 border-b border-border px-[22px] py-2">
            {(error || job?.error) && (
              <p role="alert" className="text-[12px] text-error">
                {error || job?.error}
              </p>
            )}
            {notice && (
              <p role="status" className="text-[12px] text-hms-blue">
                {notice}
              </p>
            )}
            {job?.busy && (
              <p role="status" className="text-[12px] text-hms-accent">
                {taskLabels[job.busy]} is running…
              </p>
            )}
          </div>
        )}
        {step === "Document" && (
          <div className="flex min-h-0 flex-1 overflow-auto">
            <DocumentStep
              job={job}
              file={file}
              jobs={jobs.filter((saved) => saved.projectId === projectId)}
              provider={settings.extraction.provider}
              model={settings.extraction.model}
              providerReady={available[settings.extraction.provider]}
              settingsLoaded={settingsLoaded}
              disabled={busy || active || aiBusy || Boolean(draftRows)}
              onFile={chooseFile}
              onLoad={(id) => void openRecent(id)}
              onNew={() => {
                selectedJob.current = null;
                setReport(null);
                setFile(null);
                onJobSelected?.(undefined);
                setNotice(null);
                setImported(false);
              }}
              onExplore={onExplore}
              recovery={
                job?.state === "failed" ? (
                  <div className="space-y-2 text-xs text-fg-muted">
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={useCurrentSettings}
                        disabled={busy || !settingsLoaded}
                        onChange={(event) =>
                          setUseCurrentSettings(event.target.checked)
                        }
                      />
                      <span>
                        Use current settings: {settings.extraction.model}
                      </span>
                    </label>
                    <p>
                      {extractionResumePlan(
                        job,
                        useCurrentSettings ? settings.extraction : job.profile,
                      ) === "change-required"
                        ? "This page needs a different extraction profile or a smaller document section. Change Settings before resuming."
                        : extractionResumePlan(
                              job,
                              useCurrentSettings
                                ? settings.extraction
                                : job.profile,
                            ) === "split"
                          ? "Resume will read smaller page groups. Completed groups are kept."
                          : "Resume retries the unfinished group. Completed groups are kept."}
                    </p>
                    <p>Resuming can make new AI requests.</p>
                  </div>
                ) : undefined
              }
            />
          </div>
        )}
        {step === "Map" && ready && job && (
          <div
            className={cn(
              "grid min-h-0 flex-1",
              editRow
                ? "grid-cols-[minmax(0,1fr)_minmax(280px,340px)]"
                : "grid-cols-1",
            )}
          >
            <div className="flex min-h-0 min-w-0 flex-col">
              <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card-foot px-[22px] py-3">
                <h3 className="font-display text-[17px] text-hms-blue">
                  {mapName}
                </h3>
                <span className="text-xs">{rows.length} signals</span>
                <span className="text-xs text-success">
                  {rows.filter((row) => row.reviewed).length} reviewed
                </span>
                <span className="text-xs text-warning-text">
                  {rows.filter((row) => row.warnings.length).length} with
                  warnings
                </span>
                <span
                  className={cn(
                    "ml-auto text-[10.5px]",
                    draftRows ? "text-warning-text" : "text-fg-muted",
                  )}
                >
                  {draftRows
                    ? "Unsaved changes"
                    : `Saved · ${new Date(job.updatedAt).toLocaleTimeString("en-GB")}`}
                </span>
              </div>
              {job.warnings.length > 0 && (
                <details className="shrink-0 border-b border-border px-[22px] py-2.5 text-xs text-warning-text">
                  <summary className="flex w-fit cursor-pointer list-none items-center gap-2 font-semibold">
                    <ChevronDown size={12} aria-hidden />
                    Document warnings{" "}
                    <span className="rounded-full bg-warning-bg px-2 py-0.5">
                      {job.warnings.length}
                    </span>
                  </summary>
                  <ul className="mt-2 max-h-32 space-y-2 overflow-auto rounded border border-warning-border bg-warning-bg p-3 text-[11.5px] leading-relaxed">
                    {job.warnings.map((warning, index) => {
                      const page = /(?:pages?|p\.)\s*(\d+)/i.exec(warning)?.[1];
                      return (
                        <li
                          key={index}
                          className="flex items-start justify-between gap-3"
                        >
                          <span>{warning}</span>
                          {page && Number(page) <= job.pages.length && (
                            <a
                              className="shrink-0 text-hms-accent hover:underline"
                              target="_blank"
                              rel="noreferrer"
                              href={`/api/modbus-ai/jobs/${job.id}/export?format=pdf#page=${page}`}
                            >
                              Open page
                            </a>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-[22px] py-2.5">
                <div className="flex overflow-hidden rounded border border-border">
                  {(
                    [
                      ["all", "All", rows.length],
                      [
                        "review",
                        "Needs review",
                        rows.filter((row) => row.enabled && !row.reviewed)
                          .length,
                      ],
                      [
                        "warnings",
                        "Warnings",
                        rows.filter((row) => row.warnings.length).length,
                      ],
                      [
                        "excluded",
                        "Excluded",
                        rows.filter((row) => !row.enabled).length,
                      ],
                    ] as const
                  ).map(([key, label, count]) => (
                    <button
                      type="button"
                      key={key}
                      aria-pressed={filter === key}
                      className={cn(
                        "border-r border-border px-2 py-1.5 text-[11px] font-semibold last:border-r-0",
                        filter === key
                          ? "bg-hms-blue text-white"
                          : "bg-white text-fg-muted hover:bg-row-hover",
                      )}
                      onClick={() => {
                        setFilter(key);
                        setPage(0);
                      }}
                    >
                      {label}{" "}
                      <span className="ml-1 font-normal opacity-80">
                        {count}
                      </span>
                    </button>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!canEdit}
                  onClick={() => {
                    setFilter("all");
                    setQuery("");
                    addManualRow();
                  }}
                >
                  Add signal
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!canEdit || !selected.length}
                  onClick={() =>
                    setDraftRows(
                      rows.map((row) => ({
                        ...row,
                        reviewed:
                          row.enabled && !row.addressNeedsConfirmation
                            ? true
                            : row.reviewed,
                      })),
                    )
                  }
                >
                  Mark included as reviewed
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={
                    !canEdit ||
                    Boolean(draftRows) ||
                    !available[settings.review.provider]
                  }
                  onClick={() => void action(() => analyze("review"))}
                >
                  Review with AI
                </Button>
                <a
                  href={`/api/modbus-ai/jobs/${job.id}/export?format=pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] font-semibold text-hms-accent hover:underline"
                >
                  Open PDF
                </a>
                <div className="relative ml-auto min-w-[130px] flex-1 basis-[160px]">
                  <Search
                    size={12}
                    aria-hidden
                    className="absolute left-2.5 top-2.5 text-fg-muted"
                  />
                  <Input
                    aria-label="Search map signals"
                    className="pl-7 text-xs"
                    value={query}
                    placeholder="Search signals…"
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(0);
                    }}
                  />
                </div>
              </div>
              {lastAnalysis && (
                <details className="shrink-0 border-b border-border bg-info-bg/30 px-[22px] py-2 text-xs">
                  <summary className="cursor-pointer text-hms-accent">
                    {lastAnalysis.task === "diagnosis" ? "AI diagnosis" : "AI review"} · {lastAnalysis.summary}
                  </summary>
                  <div className="mt-2 space-y-2">{findings(null)}</div>
                </details>
              )}
              <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full min-w-[670px] text-left text-[12px]">
                  <caption className="sr-only">
                    Candidate Modbus signals from the document
                  </caption>
                  <thead className="sticky top-0 z-10 bg-table-header">
                    <tr>
                      <th className={tableHeading}>
                        <span className="sr-only">Include</span>
                      </th>
                      {[
                        "Signal",
                        "FC",
                        "Address",
                        "Type",
                        "Scale / unit",
                        "Access",
                        "Status",
                      ].map((label) => (
                        <th key={label} className={tableHeading}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((row) => (
                      <React.Fragment key={row.id}>
                        <tr
                          className={cn(
                            "cursor-pointer border-b border-row-rule hover:bg-row-hover",
                            editing === row.id
                              ? "bg-row-open shadow-[inset_3px_0_0_var(--color-hms-accent)]"
                              : !row.enabled
                                ? "bg-table-header text-fg-muted"
                                : "",
                          )}
                          onClick={() => selectRow(row)}
                        >
                          <td
                            className={tableCell}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Checkbox
                              aria-label={`Include ${row.name}`}
                              checked={row.enabled}
                              disabled={!canEdit || row.addressNeedsConfirmation}
                              onChange={(event) =>
                                patchRow(row.id, {
                                  enabled: event.target.checked,
                                })
                              }
                            />
                          </td>
                          <td className={cn(tableCell, "min-w-[180px]")}>
                            <button
                              type="button"
                              className={cn(
                                "text-left outline-hms-accent",
                                editing === row.id && "font-bold text-hms-blue",
                              )}
                              onClick={(event) => {
                                event.stopPropagation();
                                selectRow(row);
                              }}
                            >
                              {row.name}
                            </button>
                            <p className="mt-0.5 font-mono text-[10px] text-fg-muted">
                              {row.sourceAddress || "Manual"} ·{" "}
                              {row.sourcePages.length
                                ? `p. ${row.sourcePages.join(", ")}`
                                : "No page"}
                            </p>
                          </td>
                          <td className={cn(tableCell, "font-mono")}>
                            {String(row.function).padStart(2, "0")}
                          </td>
                          <td
                            className={cn(tableCell, "font-mono text-hms-blue")}
                          >
                            {row.addressNeedsConfirmation
                              ? `${row.address} ?`
                              : row.address}
                          </td>
                          <td
                            className={cn(
                              tableCell,
                              "whitespace-nowrap font-mono text-[11px] text-fg-muted",
                            )}
                          >
                            {row.dataType.toUpperCase()}
                            {row.enumValues.length > 0 && (
                              <span className="ml-1 rounded bg-info-bg px-1 font-sans text-[9px] text-hms-accent">
                                enum
                              </span>
                            )}
                            {row.bit !== null ? ` · bit ${row.bit}` : ""}
                          </td>
                          <td
                            className={cn(
                              tableCell,
                              "whitespace-nowrap font-mono text-[11px] text-fg-muted",
                            )}
                          >
                            {row.scale ?? "—"}
                            {row.unit ? ` ${row.unit}` : ""}
                          </td>
                          <td
                            className={cn(
                              tableCell,
                              "whitespace-nowrap text-fg-muted",
                            )}
                          >
                            {row.access}
                          </td>
                          <td className={tableCell}>
                            <StatusBadge
                              tone={
                                !row.enabled
                                  ? "neutral"
                                  : row.warnings.length
                                    ? "warning"
                                    : row.reviewed
                                      ? "success"
                                      : "neutral"
                              }
                            >
                              {!row.enabled
                                ? "Excluded"
                                : row.warnings.length
                                  ? row.reviewed
                                    ? "Reviewed · warning"
                                    : "Warning"
                                  : row.reviewed
                                    ? "Reviewed"
                                    : "Pending"}
                            </StatusBadge>
                          </td>
                        </tr>
                        {hasCorrections(row) && (
                          <tr className="border-b border-info-border bg-info-bg/40">
                            <td colSpan={8}>{correctionRows(row)}</td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                    {!shown.length && (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-6 py-10 text-center text-fg-muted"
                        >
                          No signals match this filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {pagination}
            </div>
            {editRow && (
              <SignalEditor
                row={editRow}
                index={rows.findIndex((row) => row.id === editRow.id)}
                total={rows.length}
                jobId={job.id}
                readOnly={false}
                canEdit={canEdit}
                onPatch={(patch) => patchRow(editRow.id, patch)}
                onClose={() => setEditing(null)}
                onEditMap={() => setStep("Map")}
              >
                {lastAnalysis && (
                  <div className="space-y-2">{findings(editRow.id)}</div>
                )}
              </SignalEditor>
            )}
          </div>
        )}
        {step === "Live check" && ready && job && (
          <>
            <div className="shrink-0 border-b border-border px-[22px] py-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[260px] max-w-[390px] flex-1">
                  {destination}
                </div>
                <Field
                  label="Observe for"
                  htmlFor="ai-observe-seconds"
                  className="w-[110px]"
                >
                  <Select
                    id="ai-observe-seconds"
                    value={seconds}
                    disabled={active}
                    options={[
                      { value: "0", label: "Single pass" },
                      { value: "30", label: "30 seconds" },
                      { value: "60", label: "1 minute" },
                      { value: "120", label: "2 minutes" },
                      { value: "300", label: "5 minutes" },
                    ]}
                    onValueChange={(value) => setSeconds(Number(value))}
                  />
                </Field>
                {scan && (
                  <span
                    role="status"
                    className="self-center text-[11.5px] text-fg-muted"
                  >
                    <span
                      className={cn(
                        "mr-1.5 inline-block size-2 rounded-full",
                        active ? "bg-success" : "bg-fg-subtle",
                      )}
                    />
                    {scan.state === "scanning"
                      ? "Reading"
                      : scan.state === "completed"
                        ? "Finished"
                        : scan.state === "restoring"
                          ? "Restoring gateway"
                          : scan.state === "preparing"
                            ? "Preparing"
                            : scan.state === "restore-pending"
                              ? "Restore pending"
                              : scan.state === "cancelled"
                                ? "Stopped"
                                : "Failed"}{" "}
                    · {scan.observations?.length ?? 0} readings
                  </span>
                )}
                {active ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={
                      busy || (scan?.needsRestore && scan.state !== "scanning")
                    }
                    onClick={() =>
                      void action(async () => {
                        await request(`/api/modbus-scans/${scan!.id}`, {
                          method: "DELETE",
                        });
                      })
                    }
                  >
                    Stop
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={
                      busy ||
                      aiBusy ||
                      Boolean(draftRows) ||
                      !targets ||
                      Boolean(targetProblem) ||
                      Boolean(scan?.needsRestore) ||
                      !Number.isInteger(batchSize) ||
                      batchSize < 1 ||
                      batchSize > 512
                    }
                    onClick={() => void startCapture()}
                  >
                    {scan ? "Read again" : "Start live check"}
                  </Button>
                )}
              </div>
              <details className="mt-2 text-[11px] text-fg-muted">
                <summary className="w-fit cursor-pointer">Details</summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <p>
                    {targets} targeted reads · {Math.ceil(targets / batchSize)}{" "}
                    batches.{" "}
                    {locator.kind === "rtu"
                      ? "The check may interrupt or slow gateway operation. The original configuration is backed up and restored automatically."
                      : "The selected TCP device is read directly."}
                  </p>
                  <Field label="Signals per batch" htmlFor="ai-batch-size">
                    <Input
                      id="ai-batch-size"
                      className="max-w-[100px] font-mono"
                      type="number"
                      min={1}
                      max={512}
                      disabled={active}
                      value={batchSize}
                      onChange={(event) =>
                        setBatchSize(Number(event.target.value))
                      }
                    />
                  </Field>
                  {scan?.backupHash && (
                    <p className="break-all font-mono text-[10px] sm:col-span-2">
                      Backup SHA-256: {scan.backupHash}
                      <br />
                      Restored SHA-256: {scan.restoredHash ?? "pending"}
                    </p>
                  )}
                  {scan?.error && <p className="text-error">{scan.error}</p>}
                  {scan?.observationsTruncated && (
                    <p>
                      Recent readings are shown; older samples are outside this
                      capture window.
                    </p>
                  )}
                </div>
              </details>
              {targetProblem && (
                <p className="mt-2 text-[11.5px] text-fg-muted">
                  {targetProblem}
                </p>
              )}
              {draftRows && (
                <p className="mt-2 text-[11.5px] text-warning-text">
                  Save the map changes before starting a live check.
                </p>
              )}
            </div>
            {scan?.needsRestore && scan.state === "restore-pending" && (
              <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-warning-border bg-warning-bg px-[22px] py-2.5 text-[12px] text-warning-text">
                <p className="flex-1">
                  <strong>Gateway restoration is pending.</strong>{" "}
                  {scan.recoveryError ||
                    "Retry restoring the original configuration."}
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      try {
                        await request(`/api/modbus-scans/${scan.id}/restore`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ sessionId: session?.id }),
                        });
                      } catch (problem) {
                        if (
                          problem instanceof ApiError &&
                          [401, 403].includes(problem.status)
                        ) {
                          setRestoreOpen(true);
                          return;
                        }
                        throw problem;
                      }
                    })
                  }
                >
                  Retry restore
                </Button>
                <button
                  type="button"
                  className="text-[11px] underline"
                  onClick={() => setRestoreOpen(true)}
                >
                  Recovery details
                </button>
              </div>
            )}
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
              <div className="min-h-0 min-w-0 overflow-auto">
                <table className="w-full min-w-[470px] text-left text-[12px]">
                  <caption className="sr-only">
                    Live Modbus readings and evidence
                  </caption>
                  <thead className="sticky top-0 z-10 bg-table-header">
                    <tr>
                      {["Signal", "Raw", "Value", "Result"].map((label) => (
                        <th key={label} className={tableHeading}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {liveRows.map((row) => {
                      const result = validationById.get(row.id);
                      const status = liveResult(row, result, scan);
                      return (
                        <React.Fragment key={row.id}>
                          <tr
                            className={cn(
                              "cursor-pointer border-b border-row-rule hover:bg-row-hover",
                              editing === row.id
                                ? "bg-row-open"
                                : status.tone === "success"
                                  ? "bg-success-bg"
                                  : "",
                            )}
                            onClick={() => selectRow(row)}
                          >
                            <td className={cn(tableCell, "min-w-[170px]")}>
                              <button
                                type="button"
                                className="text-left outline-hms-accent"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  selectRow(row);
                                }}
                              >
                                {row.name}
                              </button>
                              <p className="mt-0.5 font-mono text-[10px] text-fg-muted">
                                FC0{row.function} · {row.address}
                              </p>
                            </td>
                            <td
                              className={cn(
                                tableCell,
                                "font-mono text-[11px] text-fg-muted",
                              )}
                            >
                              {result?.lastRaw?.join(", ") ?? "—"}
                            </td>
                            <td
                              className={cn(
                                tableCell,
                                "whitespace-nowrap font-mono text-[12px] font-semibold",
                              )}
                            >
                              {result?.lastValue ?? "—"}
                              {result?.lastValue !== undefined && row.unit
                                ? ` ${row.unit}`
                                : ""}
                            </td>
                            <td className={tableCell}>
                              <StatusBadge tone={status.tone}>
                                {status.label}
                              </StatusBadge>
                            </td>
                          </tr>
                          {hasCorrections(row) && (
                            <tr className="border-b border-info-border bg-info-bg/40">
                              <td colSpan={4}>{correctionRows(row)}</td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    {!liveRows.length && (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-6 py-10 text-center text-fg-muted"
                        >
                          Include signals in Map to start a live check.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {editRow ? (
                <SignalEditor
                  row={editRow}
                  index={rows.findIndex((row) => row.id === editRow.id)}
                  total={rows.length}
                  jobId={job.id}
                  readOnly
                  canEdit={canEdit}
                  result={validationById.get(editRow.id)}
                  onPatch={(patch) => patchRow(editRow.id, patch)}
                  onClose={() => setEditing(null)}
                  onEditMap={() => setStep("Map")}
                >
                  <div className="space-y-4 border-t border-border pt-4">
                    {findings(editRow.id)}
                    {guidedPanel}
                    {aiPanel}
                  </div>
                </SignalEditor>
              ) : (
                <aside
                  aria-label="Live check tools"
                  className="min-h-0 space-y-4 overflow-auto border-l border-border px-4 py-4"
                >
                  {guidedPanel}
                  {aiPanel}
                </aside>
              )}
            </div>
          </>
        )}
        {step === "Import" && ready && job && (
          <div className="min-h-0 flex-1 overflow-auto px-6 py-7">
            <div className="mx-auto max-w-[1050px] space-y-5">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h3 className="font-display text-[23px] font-light text-hms-blue">
                    {selected.length} signals to import
                  </h3>
                  <p className="mt-1 text-xs text-fg-muted">
                    {rows.length - selected.length}{" "}
                    {rows.length - selected.length === 1
                      ? "excluded signal stays out."
                      : "excluded signals stay out."}
                  </p>
                </div>
                <div className="min-w-[300px] max-w-[480px] flex-1">
                  {destination}
                </div>
              </div>
              <p className="text-[12px] text-fg-muted">
                Device:{" "}
                <strong className="font-semibold text-text-body">
                  {mapName}
                </strong>
              </p>
              <div className="grid grid-cols-1 overflow-hidden rounded-md border border-border sm:grid-cols-3">
                {(
                  [
                    [validatedCount, "Live-validated", "success"],
                    [readCount, "Read OK", "read"],
                    [
                      selected.length - validatedCount - readCount,
                      "Not live-validated",
                      "unvalidated",
                    ],
                  ] as const
                ).map(([count, label, tone]) => (
                  <div
                    key={label}
                    className="flex items-center gap-3 border-b border-border p-3 last:border-0 sm:border-b-0 sm:border-r"
                  >
                    <span className="font-mono text-[20px] text-hms-blue">
                      {count}
                    </span>
                    <StatusBadge tone={tone}>{label}</StatusBadge>
                  </div>
                ))}
              </div>
              {!hasLiveEvidence && (
                <div className="flex flex-wrap items-center gap-3 rounded border border-border bg-[#F6F8FA] px-3 py-2.5 text-[12px]">
                  <p className="flex-1">
                    The map is saved. You can run the live check before
                    importing.
                  </p>
                  <button
                    type="button"
                    className="font-semibold text-hms-accent hover:underline"
                    onClick={() => navigateStep("Live check")}
                  >
                    Go to live check
                  </button>
                </div>
              )}
              <p className="rounded border border-warning-border bg-warning-bg px-3 py-2 text-[12px] text-warning-text">
                Modbus writes are disabled.
                {inactiveCount
                  ? ` ${inactiveCount} Trigger or write-only signals will be imported inactive.`
                  : ""}
              </p>
              {importProblem && !imported && (
                <p role="status" className="text-[12px] text-warning-text">
                  {importProblem}
                </p>
              )}
              {imported && (
                <p
                  role="status"
                  className="rounded border border-success-border bg-success-bg px-3 py-2 text-[12px] text-success"
                >
                  <Check size={13} className="mr-1 inline" aria-hidden />
                  Signals added to the project draft.
                </p>
              )}
              <div className="overflow-auto rounded-md border border-border">
                <table className="w-full min-w-[700px] text-left text-[12px]">
                  <thead className="bg-table-header">
                    <tr>
                      {[
                        "Signal",
                        "FC",
                        "Address",
                        "Type",
                        "Scale / unit",
                        "Import as",
                        "Validation",
                      ].map((label) => (
                        <th key={label} className={tableHeading}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selected.map((row) => {
                      const result = liveResult(
                        row,
                        validationById.get(row.id),
                        scan,
                      );
                      return (
                        <tr key={row.id} className="border-t border-row-rule">
                          <td className={tableCell}>{row.name}</td>
                          <td className={cn(tableCell, "font-mono")}>
                            {String(row.function).padStart(2, "0")}
                          </td>
                          <td className={cn(tableCell, "font-mono")}>
                            {row.address}
                          </td>
                          <td
                            className={cn(tableCell, "font-mono text-[11px]")}
                          >
                            {row.dataType.toUpperCase()}
                            {row.enumValues.length > 0 ? " · enum" : ""}
                          </td>
                          <td
                            className={cn(tableCell, "font-mono text-[11px]")}
                          >
                            {row.scale ?? "—"}
                            {row.unit ? ` ${row.unit}` : ""}
                          </td>
                          <td
                            className={cn(
                              tableCell,
                              row.access === "W" || row.access === "Trigger"
                                ? "text-warning-text"
                                : "text-fg-muted",
                            )}
                          >
                            {row.access === "W" || row.access === "Trigger"
                              ? "Inactive"
                              : "Active"}
                          </td>
                          <td className={tableCell}>
                            <StatusBadge tone={result.tone}>
                              {result.label === "Waiting…" ||
                              result.label === "Not read"
                                ? "Not live-validated"
                                : result.label}
                            </StatusBadge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-fg-muted">
                Validation evidence stays in this saved map and the JSON report.
                Imported signals use the native MAPS format.
              </p>
            </div>
          </div>
        )}
      </Modal>
      {restoreOpen && scan && (
        <ModbusScanModal
          initialLocator={scan.input.locator}
          initialJobId={scan.id}
          onClose={() => setRestoreOpen(false)}
        />
      )}
      {confirmClose && (
        <Modal
          title="Save map changes?"
          description="The changes to this document map have not been saved."
          ctaLabel="Save and close"
          ctaDisabled={!canEdit}
          onClose={() => setConfirmClose(false)}
          onConfirm={() =>
            void action(async () => {
              await saveMap();
              onClose();
            })
          }
        >
          <p className="text-[12px] text-fg-muted">
            Save them to resume reviewing this map later.
          </p>
          <Button
            className="mt-3"
            size="sm"
            variant="secondary"
            onClick={onClose}
          >
            Discard changes and close
          </Button>
        </Modal>
      )}
    </>
  );
}
