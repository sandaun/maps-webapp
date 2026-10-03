"use client";
import * as React from "react";
import { ApiError, request } from "@/lib/api";
import { useCurrentProject } from "@/lib/current-project";
import { useGatewaySession } from "@/lib/gateway-session";
import { usePropertyDrafts } from "@/lib/property-drafts";
import type { NodeLocator, ProjectView } from "@/lib/project-types";
import { DEFAULT_AI_SETTINGS, MODELS, PROVIDERS, TASKS, DATA_TYPES, BYTE_ORDERS, MAX_AUTOMATIC_ANALYSES, type AISettings, type AIProvider, type AITask, type CandidateSignal, type ModbusAIJob, type ValidationResult } from "@/core/modbus-ai/model";
import { isScanTerminal, type ScanJob } from "@/core/modbus-scan/model";
import { validationTargets } from "@/core/modbus-ai/validation";
import { Modal } from "@/components/ui/modal";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { ModbusScanModal } from "./modbus-scan-modal";

type Report = { job: ModbusAIJob; scan?: ScanJob; validation: ValidationResult[]; scope: string };
type SettingsResponse = { settings: AISettings; available: Record<AIProvider, boolean> };
const taskLabels = { extraction: "PDF extraction", diagnosis: "Live diagnosis", review: "Detailed review" };
const steps = ["PDF", "Map", "Live validation", "Report"] as const;

export function ModbusAIModal({ initialLocator, onClose }: { initialLocator: NodeLocator; onClose: () => void }) {
  const { view, projectId, acceptView, mutating } = useCurrentProject(); const { session } = useGatewaySession(); const drafts = usePropertyDrafts();
  const [settings, setSettings] = React.useState(DEFAULT_AI_SETTINGS); const [available, setAvailable] = React.useState<Record<AIProvider, boolean>>({ openai: false, anthropic: false, kimi: false });
  const [settingsDirty, setSettingsDirty] = React.useState(false); const [jobs, setJobs] = React.useState<ModbusAIJob[]>([]);
  const [report, setReport] = React.useState<Report | null>(null); const [draftRows, setDraftRows] = React.useState<CandidateSignal[] | null>(null);
  const [step, setStep] = React.useState<typeof steps[number]>("PDF"); const [file, setFile] = React.useState<File | null>(null);
  const [locator, setLocator] = React.useState(initialLocator); const [slave, setSlave] = React.useState(1); const [seconds, setSeconds] = React.useState(60); const [batchSize, setBatchSize] = React.useState(128);
  const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState<string | null>(null); const [notice, setNotice] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(0); const [editing, setEditing] = React.useState<string | null>(null); const [autoDiagnosis, setAutoDiagnosis] = React.useState(false);
  const [experimentSignal, setExperimentSignal] = React.useState(""); const [before, setBefore] = React.useState(""); const [after, setAfter] = React.useState(""); const [description, setDescription] = React.useState(""); const [changeAt, setChangeAt] = React.useState("");
  const [restoreOpen, setRestoreOpen] = React.useState(false);
  const selectedJob = React.useRef<string | null>(null); const pollBusy = React.useRef(false);
  const job = report?.job.projectId === projectId ? report.job : undefined; const scan = job ? report?.scan : undefined; const rows = draftRows ?? job?.signals ?? [];
  const active = Boolean(scan && !isScanTerminal(scan.state)); const aiBusy = Boolean(job?.busy || job?.state === "extracting");
  const hasProjectEdits = Object.keys(drafts.snapshot.projects[projectId ?? ""]?.edits ?? {}).length > 0;
  const selected = rows.filter((r) => r.enabled); const canEdit = !busy && !active && !aiBusy;
  const nodes = view?.family === "knx-mbm" ? [...view.project.mbm.rtuNodes.map((n, nodeIndex) => ({ locator: { kind: "rtu" as const, nodeIndex }, label: `RTU ${nodeIndex + 1} · ${n.baudrate} baud` })), ...view.project.mbm.tcpNodes.map((n, nodeIndex) => ({ locator: { kind: "tcp" as const, nodeIndex }, label: `TCP ${nodeIndex + 1} · ${n.ip}:${n.port}` }))] : [];

  React.useEffect(() => {
    let disposed = false; selectedJob.current = null;
    void request<SettingsResponse>("/api/modbus-ai/settings").then((result) => { if (!disposed) { setSettings(result.settings); setAvailable(result.available); } }).catch((e) => { if (!disposed) setError(e.message); });
    const poll = async () => {
      if (pollBusy.current || !projectId) return; pollBusy.current = true;
      try {
        const next = await request<{ jobs: ModbusAIJob[] }>(`/api/modbus-ai/jobs?projectId=${encodeURIComponent(projectId)}`);
        if (disposed) return; setJobs(next.jobs);
        const id = selectedJob.current;
        if (id) { const result = await request<Report>(`/api/modbus-ai/jobs/${id}`); if (!disposed && selectedJob.current === id) setReport(result); }
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : "Could not load document maps"); }
      finally { pollBusy.current = false; }
    };
    void poll(); const timer = window.setInterval(() => void poll(), 1500);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [projectId]);

  async function action(work: () => Promise<void>) { setBusy(true); setError(null); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "Operation failed"); } finally { setBusy(false); } }
  async function load(id: string) { selectedJob.current = id; setDraftRows(null); setEditing(null); setPage(0); const next = await request<Report>(`/api/modbus-ai/jobs/${id}`); if (next.job.projectId !== projectId) throw new Error("This map belongs to a different project."); setReport(next); }
  function changeProfile(task: AITask, patch: Partial<AISettings[AITask]>) { setSettings((old) => ({ ...old, [task]: { ...old[task], ...patch } })); setSettingsDirty(true); }
  async function saveSettings() { const result = await request<SettingsResponse>("/api/modbus-ai/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) }); setSettings(result.settings); setAvailable(result.available); setSettingsDirty(false); }
  async function upload() {
    if (!file || !projectId) return;
    await action(async () => { if (settingsDirty) await saveSettings(); const form = new FormData(); form.append("projectId", projectId); form.append("file", file); const next = await request<{ job: ModbusAIJob }>("/api/modbus-ai/jobs", { method: "POST", body: form }); await load(next.job.id); setStep("Map"); });
  }
  function patchRow(id: string, patch: Partial<CandidateSignal>) { setDraftRows(rows.map((row) => row.id === id ? { ...row, ...patch, reviewed: patch.reviewed ?? false } : row)); }
  function addManualRow() {
    const row: CandidateSignal = { id: crypto.randomUUID(), name: "New signal", description: "", function: 3, address: 0, sourceAddress: "manual", addressBasis: "explicit", dataType: "uint16", byteOrder: null, bit: null, scale: null, offset: null, unit: null, access: "unknown", min: null, max: null, enumValues: [], sentinels: [], sourcePages: [], sourceQuote: "", applicableModels: [], warnings: ["Manually added; verify its address, encoding and source before import."], reviewed: false, enabled: true };
    setDraftRows([...rows, row]); setEditing(row.id); setPage(Math.floor(rows.length / 40));
  }
  async function saveMap() {
    if (!job || !draftRows) return;
    const next = await request<{ job: ModbusAIJob }>(`/api/modbus-ai/jobs/${job.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: job.revision, signals: draftRows }) });
    setDraftRows(null); setReport((old) => old ? { ...old, job: next.job, validation: [] } : old);
  }
  let targetProblem: string | undefined;
  if (hasProjectEdits || mutating) targetProblem = "Save project edits before capturing or importing.";
  else if (!Number.isInteger(slave) || slave < 1 || slave > 247) targetProblem = "Choose slave 1–247.";
  else if (!nodes.some((n) => n.locator.kind === locator.kind && n.locator.nodeIndex === locator.nodeIndex)) targetProblem = "Choose an existing connection.";
  else if (locator.kind === "rtu" && (!session?.connected || session.gateway?.appId !== 4)) targetProblem = "Connect to a KNX–MBM gateway in Connection.";
  else if (locator.kind === "rtu" && (session?.busy || session?.monitoring)) targetProblem = "Stop gateway diagnostics monitoring before capture.";
  let targets = 0; try { targets = validationTargets(rows).length; } catch (e) { targetProblem = e instanceof Error ? e.message : "Invalid targets"; }
  const startCapture = async () => {
    if (!job || draftRows) return;
    await action(async () => { const result = await request<{ job: ModbusAIJob; scan: ScanJob }>(`/api/modbus-ai/jobs/${job.id}/validate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: job.revision, input: { locator, slave, sessionId: session?.id, batchSize, maxPoints: 4096, maxDurationSeconds: 600, observationSeconds: seconds } }) }); setReport({ job: result.job, scan: result.scan, validation: [], scope: report!.scope }); });
  };
  async function analyze(task: "diagnosis" | "review") {
    if (!job || draftRows) return;
    if (settingsDirty) await saveSettings();
    const next = await request<{ job: ModbusAIJob }>(`/api/modbus-ai/jobs/${job.id}/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: job.revision, task }) });
    setReport((old) => old ? { ...old, job: next.job } : old);
  }
  const diagnosisJobId = job?.id; const diagnosisRevision = job?.revision; const diagnosisBusy = job?.busy; const diagnosisCount = job?.analyses.length; const captureState = scan?.state;
  const automaticAttempts = job?.automaticAttempts?.[scan?.id ?? ""] ?? 0;
  // Only one request per window; server rate limiting also protects retries.
  React.useEffect(() => {
    if (!autoDiagnosis || captureState !== "scanning" || !diagnosisJobId || diagnosisBusy || automaticAttempts >= MAX_AUTOMATIC_ANALYSES || draftRows || settingsDirty || !available[settings.diagnosis.provider]) return;
    const timer = window.setTimeout(() => {
      void request<{ job: ModbusAIJob }>(`/api/modbus-ai/jobs/${diagnosisJobId}/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: diagnosisRevision, task: "diagnosis", automatic: true }) }).catch((e) => { if (!(e instanceof ApiError && [409, 429].includes(e.status))) { setError(e.message); setAutoDiagnosis(false); } });
    }, 10000);
    return () => window.clearTimeout(timer);
  }, [autoDiagnosis, captureState, diagnosisJobId, diagnosisRevision, diagnosisBusy, diagnosisCount, automaticAttempts, draftRows, settingsDirty, available, settings.diagnosis.provider]);

  async function recordExperiment() {
    if (!job) return;
    await action(async () => { await request(`/api/modbus-ai/jobs/${job.id}/experiments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: job.revision, experiment: { signalId: experimentSignal, at: changeAt, before: Number(before), after: Number(after), description, tolerance: 0.1 } }) }); await load(job.id); setNotice("Recorded the external change. Keep capture running for the after sample."); });
  }
  async function importMap() {
    if (!job || !view || draftRows) return;
    await action(async () => { const next = await request<ProjectView>(`/api/modbus-ai/jobs/${job.id}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: job.revision, projectRevision: view.meta.revision ?? 0, selected: selected.map((r) => r.id), target: { ...locator, slave } }) }); acceptView?.(next); setNotice(`Added ${selected.length} reviewed signals to the project. Modbus writes are disabled.`); });
  }
  const editRow = rows.find((r) => r.id === editing); const shown = rows.slice(page * 40, page * 40 + 40);
  const validationById = new Map(report?.validation.map((r) => [r.signalId, r]));
  const lastAnalysis = job?.analyses.filter((a) => a.revision === job.revision).at(-1);
  const canImport = Boolean(job?.state === "ready" && !busy && !aiBusy && !active && !scan?.needsRestore && !draftRows && selected.length && selected.every((r) => r.reviewed) && !hasProjectEdits);
  return <>
    <Modal title="Device map from PDF" description="Extract a candidate map, review its source and validate it against the connected Modbus device." width={1200} scrollable ctaLabel={`Add ${selected.length} reviewed signals`} ctaDisabled={!canImport} onConfirm={() => void importMap()} onClose={onClose} closeLabel="Close" foot={active ? "Capture continues on the server. Cancel capture to restore the gateway." : "Import changes the project draft. Modbus writes are disabled."}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Document validation steps">{steps.map((name) => <Button key={name} role="tab" aria-selected={step === name} size="sm" variant={step === name ? "default" : "secondary"} onClick={() => setStep(name)}>{name}</Button>)}</div>
        {error && <p role="alert" className="rounded border border-error/30 bg-error-bg p-3 text-sm text-error">{error}</p>}
        {notice && <p role="status" className="text-sm text-hms-blue">{notice}</p>}
        {job && <p role="status" className="text-sm">{job.fileName} · {job.progress}{job.busy ? ` · ${taskLabels[job.busy]} running` : ""}</p>}
        {job?.error && <p role="alert" className="text-sm text-error">{job.error}</p>}
        {step === "PDF" && <>
          <details open><summary className="cursor-pointer text-sm font-medium">AI providers and models</summary>
            <div className="mt-3 space-y-3">{TASKS.map((task) => <div key={task} className="grid gap-2 sm:grid-cols-4">
              <span className="self-center text-sm">{taskLabels[task]}</span>
              <Select aria-label={`${taskLabels[task]} provider`} value={settings[task].provider} onValueChange={(value) => { const provider = value as AIProvider; changeProfile(task, { provider, model: provider === "openai" ? task === "diagnosis" ? "gpt-6-luna" : "gpt-6.1-sol" : MODELS[provider][0], effort: provider === "openai" && task === "diagnosis" ? "none" : "low" }); }} options={PROVIDERS.map((provider) => ({ value: provider, label: `${provider}${available[provider] ? " · configured" : " · key needed"}` }))} />
              <Select aria-label={`${taskLabels[task]} model`} value={settings[task].model} onValueChange={(model) => changeProfile(task, { model, effort: model === "gpt-6-luna" ? "none" : "low" })} options={MODELS[settings[task].provider].map((model) => ({ value: model, label: model }))} />
              <Select aria-label={`${taskLabels[task]} reasoning`} value={settings[task].effort} onValueChange={(effort) => changeProfile(task, { effort: effort as AISettings[AITask]["effort"] })} options={(settings[task].model === "kimi-k3" ? ["low", "high", "max"] : settings[task].model === "gpt-6-luna" ? ["none", "low", "medium", "high", "max"] : ["low", "medium", "high", "max"]).map((value) => ({ value, label: value }))} />
            </div>)}<Button size="sm" variant="secondary" disabled={!settingsDirty || busy} onClick={() => void action(saveSettings)}>Save AI settings</Button></div>
          </details>
          <p className="text-xs text-fg-muted">Extraction uses one AI request per 15 PDF pages (up to 14 requests). Each review or diagnosis uses one request.</p>
          <p className="text-xs text-fg-muted">Selected provider receives the PDF for extraction and relevant source/observations for analysis. Keys stay on the server. Kimi uses PDF text; use OpenAI or Claude for scanned pages. K3 availability depends on the account.</p>
          <Field label="Technical PDF (up to 20 MB / 200 pages)"><Input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
          <Button disabled={!file || busy || !available[settings.extraction.provider]} onClick={() => void upload()}>Generate candidate map</Button>
          {!available[settings.extraction.provider] && <p className="text-sm text-fg-muted">Configure the provider key on the server to run extraction. You can select models and reopen saved maps now.</p>}
          <Field label="Saved document maps"><Select value={job?.id ?? ""} aria-label="Saved document map" options={[{ value: "", label: "Choose a saved map" }, ...jobs.filter((j) => j.projectId === projectId).map((j) => ({ value: j.id, label: `${j.fileName} · ${j.signals.length} signals · ${j.state}` }))]} onValueChange={(id) => { if (id) void action(async () => { await load(id); setStep("Map"); }); }} /></Field>
        </>}
        {step !== "PDF" && !job && <p className="text-sm text-fg-muted">Upload a PDF or reopen a saved map to continue.</p>}
        {step === "Map" && job?.state === "ready" && <>
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={!canEdit} onClick={addManualRow}>Add signal manually</Button><Button size="sm" variant="secondary" disabled={!draftRows || !canEdit} onClick={() => void action(saveMap)}>Save map changes</Button><Button size="sm" variant="secondary" disabled={!canEdit} onClick={() => setDraftRows(rows.map((r) => ({ ...r, reviewed: r.enabled ? true : r.reviewed })))}>Mark selected as reviewed</Button><Button size="sm" variant="secondary" disabled={!canEdit || Boolean(draftRows) || !available[settings.review.provider]} onClick={() => void action(() => analyze("review"))}>Review against PDF with AI</Button><a className="self-center text-sm text-hms-blue underline" href={`/api/modbus-ai/jobs/${job.id}/export?format=pdf`} target="_blank" rel="noreferrer">Open source PDF</a></div>
          <p className="text-xs text-fg-muted">Addresses below are zero-based PDU offsets. Source addresses, pages and quotes stay attached. Review each candidate and model applicability before marking it reviewed.</p>
          {job.warnings.length > 0 && <details><summary className="text-sm">Document warnings ({job.warnings.length})</summary><ul className="list-disc pl-5 text-xs">{job.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
          <div className="overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th>Include</th><th>Signal / source</th><th>FC</th><th>PDU address</th><th>Type</th><th>Scale</th><th>Access from PDF</th><th>Review</th></tr></thead><tbody>{shown.map((row) => <tr key={row.id} className="border-t border-border"><td className="p-2"><Checkbox aria-label={`Include ${row.name}`} checked={row.enabled} disabled={!canEdit} onChange={(e) => patchRow(row.id, { enabled: e.target.checked })} /></td><td className="max-w-[300px] p-2"><button className="text-left text-hms-blue underline" onClick={() => setEditing(row.id)}>{row.name}</button><div className="text-fg-muted">Source {row.sourceAddress} · pages {row.sourcePages.join(", ") || "unknown"}{row.applicableModels.length ? ` · ${row.applicableModels.join(", ")}` : ""}</div></td><td>{row.function}</td><td className="font-mono">{row.address}</td><td>{row.dataType}{row.bit !== null ? ` bit ${row.bit}` : ""}</td><td>{row.scale ?? "unspecified"}{row.unit ? ` ${row.unit}` : ""}</td><td>{row.access}</td><td><Checkbox aria-label={`Reviewed ${row.name}`} checked={row.reviewed} disabled={!canEdit} onChange={(e) => patchRow(row.id, { reviewed: e.target.checked })} /> {row.warnings.length > 0 ? `${row.warnings.length} warnings` : ""}</td></tr>)}</tbody></table></div>
          <div className="flex items-center gap-3"><Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-xs">{page + 1} / {Math.max(1, Math.ceil(rows.length / 40))} · {rows.length} signals</span><Button size="sm" variant="secondary" disabled={(page + 1) * 40 >= rows.length} onClick={() => setPage(page + 1)}>Next</Button></div>
          {editRow && <div className="space-y-3 rounded border border-border bg-card-foot p-3"><p className="text-sm font-medium">Edit {editRow.name}</p><p className="text-xs">PDF quote: {editRow.sourceQuote || "No source quote"}</p><div className="grid gap-3 sm:grid-cols-4">
            <Field label="Name"><Input disabled={!canEdit} value={editRow.name} onChange={(e) => patchRow(editRow.id, { name: e.target.value })} /></Field>
            <Field label="Read function"><Select disabled={!canEdit} value={editRow.function} options={[1, 2, 3, 4].map((v) => ({ value: String(v), label: `FC0${v}` }))} onValueChange={(v) => patchRow(editRow.id, { function: Number(v) as CandidateSignal["function"], ...(Number(v) <= 2 ? { dataType: "bit", bit: null } : {}) })} /></Field>
            <Field label="PDU address (base 0)"><Input disabled={!canEdit} type="number" min={0} max={65535} value={editRow.address} onChange={(e) => patchRow(editRow.id, { address: Number(e.target.value), addressBasis: "explicit" })} /></Field>
            <Field label="Datatype"><Select disabled={!canEdit} value={editRow.dataType} options={(editRow.function <= 2 ? ["bit"] : DATA_TYPES).map((value) => ({ value, label: value }))} onValueChange={(v) => patchRow(editRow.id, { dataType: v as CandidateSignal["dataType"] })} /></Field>
            <Field label="Byte / word order"><Select disabled={!canEdit} value={editRow.byteOrder ?? ""} options={[{ value: "", label: "Undocumented" }, ...BYTE_ORDERS.map((value) => ({ value, label: value }))]} onValueChange={(v) => patchRow(editRow.id, { byteOrder: v ? v as CandidateSignal["byteOrder"] : null })} /></Field>
            <Field label="Raw × scale"><Input disabled={!canEdit} type="number" step="any" value={editRow.scale ?? ""} onChange={(e) => patchRow(editRow.id, { scale: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
            <Field label="+ offset"><Input disabled={!canEdit} type="number" step="any" value={editRow.offset ?? ""} onChange={(e) => patchRow(editRow.id, { offset: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
            <Field label="Unit"><Input disabled={!canEdit} value={editRow.unit ?? ""} onChange={(e) => patchRow(editRow.id, { unit: e.target.value || null })} /></Field>
            <Field label="Bit within register"><Input disabled={!canEdit || editRow.function <= 2} type="number" min={0} max={15} value={editRow.bit ?? ""} onChange={(e) => patchRow(editRow.id, { bit: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
            <Field label="Access claimed by document"><Select disabled={!canEdit} value={editRow.access} options={["R", "W", "R/W", "Trigger", "unknown"].map((value) => ({ value, label: value }))} onValueChange={(v) => patchRow(editRow.id, { access: v as CandidateSignal["access"] })} /></Field>
            <Field label="Minimum (engineering)"><Input disabled={!canEdit} type="number" step="any" value={editRow.min ?? ""} onChange={(e) => patchRow(editRow.id, { min: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
            <Field label="Maximum (engineering)"><Input disabled={!canEdit} type="number" step="any" value={editRow.max ?? ""} onChange={(e) => patchRow(editRow.id, { max: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
          </div><ul className="list-disc pl-5 text-xs text-fg-muted">{editRow.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
        </>}
        {step === "Live validation" && job?.state === "ready" && <>
          <div className="grid gap-3 sm:grid-cols-3"><Field label="Connection"><Select value={`${locator.kind}:${locator.nodeIndex}`} disabled={active} options={nodes.map((n) => ({ value: `${n.locator.kind}:${n.locator.nodeIndex}`, label: n.label }))} onValueChange={(v) => { const [kind, index] = v.split(":"); setLocator({ kind: kind as NodeLocator["kind"], nodeIndex: Number(index) }); }} /></Field><Field label="Slave / unit ID"><Input type="number" min={1} max={247} disabled={active} value={slave} onChange={(e) => setSlave(Number(e.target.value))} /></Field><Field label="Observation seconds per batch"><Input type="number" min={0} max={300} disabled={active} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} /></Field><Field label="Signals per batch"><Input type="number" min={1} max={512} disabled={active} value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))} /></Field></div>
          <p className="text-sm">{targets} targeted read requests · {Math.ceil(targets / batchSize)} batches. RTU may interrupt or slow gateway operation while temporary signals are installed. The original configuration is backed up and restored.</p>
          {targetProblem && <p className="text-sm text-fg-muted">{targetProblem}</p>}
          {draftRows && <p className="text-sm">Save the map changes before capture.</p>}
          <div className="flex flex-wrap gap-2"><Button disabled={busy || active || aiBusy || Boolean(draftRows) || !targets || Boolean(targetProblem) || !Number.isInteger(seconds) || seconds < 0 || seconds > 300 || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 512} onClick={() => void startCapture()}>Start live validation</Button><Button variant="secondary" disabled={!active || busy || scan?.needsRestore && scan.state !== "scanning"} onClick={() => void action(async () => { await request(`/api/modbus-scans/${scan!.id}`, { method: "DELETE" }); })}>Cancel capture and restore</Button>{scan?.needsRestore && <Button variant="secondary" onClick={() => setRestoreOpen(true)}>Open restoration status</Button>}</div>
          {scan && <p role="status" className="text-sm">Capture: {scan.state} · batch {scan.batch}/{scan.batches} · {scan.observations?.length ?? 0} timestamped observations{scan.observationsTruncated ? " (recent window; older samples omitted)" : ""}{scan.error ? ` · ${scan.error}` : ""}</p>}
          {scan?.backupHash && <p className="break-all font-mono text-xs">Backup SHA-256: {scan.backupHash}<br />Restored: {scan.restoredHash ?? "pending"}</p>}
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={autoDiagnosis} disabled={!available[settings.diagnosis.provider] || settingsDirty} onChange={(e) => setAutoDiagnosis(e.target.checked)} />Analyze capture windows with AI every 10 seconds while open (maximum {MAX_AUTOMATIC_ANALYSES} per capture)</label>
          <p className="text-xs text-fg-muted">Automatic diagnosis is off by default. {automaticAttempts}/{MAX_AUTOMATIC_ANALYSES} automatic analyses used for this capture; manual analyses require a click.</p>
          <Button size="sm" variant="secondary" disabled={busy || aiBusy || Boolean(draftRows) || !scan || !available[settings.diagnosis.provider]} onClick={() => void action(() => analyze("diagnosis"))}>Analyze current observations</Button>
          <div className="space-y-3 rounded border border-border p-3"><p className="text-sm font-medium">Guided external change</p><p className="text-xs text-fg-muted">Start capture, wait for a baseline, change one value on the equipment/simulator and record the actual time. MAPS performs no Modbus write.</p><div className="grid gap-3 sm:grid-cols-4"><Field label="Signal"><Select value={experimentSignal} options={[{ value: "", label: "Choose a signal" }, ...selected.map((r) => ({ value: r.id, label: r.name }))]} onValueChange={setExperimentSignal} /></Field><Field label="Before (engineering)"><Input type="number" step="any" value={before} onChange={(e) => setBefore(e.target.value)} /></Field><Field label="After (engineering)"><Input type="number" step="any" value={after} onChange={(e) => setAfter(e.target.value)} /></Field><Field label="What changed"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field></div><div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="secondary" disabled={!scan || busy} onClick={() => setChangeAt(new Date().toISOString())}>Mark change time now</Button><Input aria-label="Change time (ISO)" className="max-w-xs font-mono" value={changeAt} onChange={(e) => setChangeAt(e.target.value)} /><Button size="sm" disabled={busy || !experimentSignal || before === "" || after === "" || !description || !changeAt} onClick={() => void recordExperiment()}>Record test</Button></div></div>
          <ValidationTable rows={selected} validationById={validationById} />
        </>}
        {step === "Report" && job?.state === "ready" && <>
          <p className="text-sm">{report?.scope}</p><div className="flex flex-wrap gap-3"><a className="text-sm text-hms-blue underline" href={`/api/modbus-ai/jobs/${job.id}/export`}>Download evidence report (JSON)</a>{canImport ? <a className={buttonVariants({ size: "sm", variant: "secondary" })} href={`/api/modbus-ai/jobs/${job.id}/export?format=template`}>Download MAPS template</a> : <Button size="sm" variant="secondary" disabled>Download MAPS template</Button>}</div><ValidationTable rows={rows} validationById={validationById} />
          <p className="text-xs text-fg-muted">Map revision {job.revision}. Editing invalidates earlier validation for the new revision. AI findings are proposals and never mark the entire map validated.</p>
        </>}
        {step !== "PDF" && lastAnalysis && <div className="space-y-3 rounded border border-border p-3"><p className="text-sm font-medium">{taskLabels[lastAnalysis.task]} · {lastAnalysis.profile.model} · {(lastAnalysis.latencyMs / 1000).toFixed(1)} s</p><p className="text-sm">{lastAnalysis.summary}</p>{lastAnalysis.findings.map((f, i) => <details key={i}><summary className="text-sm">{f.severity} · {f.confidence} confidence · {f.claim}</summary><ul className="list-disc pl-5 text-xs">{f.evidence.map((e, index) => <li key={index}>{e}</li>)}</ul>{f.nextCheck && <p className="text-xs">Next check: {f.nextCheck}</p>}</details>)}{lastAnalysis.corrections.map((c, index) => <div key={index} className="flex items-center gap-3 text-xs"><span className="flex-1">{rows.find((r) => r.id === c.signalId)?.name}: {c.field} → {c.value}. {c.reason}</span><Button size="sm" variant="secondary" disabled={!canEdit || Boolean(draftRows)} onClick={() => void action(async () => { await request(`/api/modbus-ai/jobs/${job!.id}/corrections`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: job!.revision, analysisId: lastAnalysis.id, index }) }); await load(job!.id); })}>Accept proposal</Button></div>)}</div>}
      </div>
    </Modal>
    {restoreOpen && scan && <ModbusScanModal initialLocator={scan.input.locator} initialJobId={scan.id} onClose={() => setRestoreOpen(false)} />}
  </>;
}

function ValidationTable({ rows, validationById }: { rows: CandidateSignal[]; validationById: Map<string, ValidationResult> }) {
  return <div className="max-h-80 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th>Signal</th><th>Last raw → value</th>{["address", "type", "scale", "meaning", "access"].map((key) => <th key={key} className="capitalize">{key}</th>)}</tr></thead><tbody>{rows.map((row) => { const result = validationById.get(row.id); return <tr key={row.id} className="border-t border-border"><td className="p-2">{row.name}<div className="text-fg-muted">FC0{row.function} · PDU {row.address}</div></td><td className="p-2 font-mono">{result?.lastRaw?.join(", ") ?? "—"} → {result?.lastValue ?? "—"}{row.unit ? ` ${row.unit}` : ""}<div className="text-[10px]">{result?.lastAt}</div>{result?.warnings.map((w, i) => <p key={i} className="max-w-xs font-sans text-fg-muted">{w}</p>)}</td>{(["address", "type", "scale", "meaning", "access"] as const).map((key) => <td key={key} className="p-2"><details><summary className={result?.checks[key].state === "contradicted" ? "text-error" : ""}>{result?.checks[key].state ?? (key === "access" ? "untested" : "pending")}</summary>{result?.checks[key].evidence.map((e, i) => <p className="max-w-xs" key={i}>{e}</p>)}</details></td>)}</tr>; })}</tbody></table></div>;
}
