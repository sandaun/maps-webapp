import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { candidateSchema, settingsSchema, analysisSchema, experimentSchema, MAX_AUTOMATIC_ANALYSES, type AITask, type ModbusAIJob, type ValidationResult } from "@/core/modbus-ai/model";
import { normalizeExtraction, rawExtractionSchema, type RawExtraction } from "@/core/modbus-ai/extraction";
import { validateSignals, validationTargets } from "@/core/modbus-ai/validation";
import { isScanTerminal, type ScanInput } from "@/core/modbus-scan/model";
import { getModbusScanService, nodeFingerprint, type ModbusScanService } from "@/server/modbus-scan/service";
import { getProjectView } from "@/server/projects/service";
import { ProjectServiceError } from "@/server/projects/errors";
import { withProjectLock } from "@/server/projects/project-lock";
import { normalizeCorrection } from "@/core/modbus-ai/corrections";
import { checkProfile, generateJSON, providerAvailability, requireCredential } from "./providers";
import { ModbusAIStore } from "./store";
import { extractPdfEvidencePages } from "./pdf-text";
import { EXTRACTION_PROMPT, DIAGNOSIS_PROMPT } from "./prompt";

const message = (e: unknown) => e instanceof Error ? e.message : "Operation failed";
export class ModbusAIService {
  private jobs = new Map<string, ModbusAIJob>();
  private tasks = new Map<string, Promise<void>>();
  private initialization?: Promise<void>;
  constructor(readonly store = new ModbusAIStore(), private readonly scans: ModbusScanService = getModbusScanService(), private readonly generate = generateJSON, private readonly getView = getProjectView) {}
  async initialize() {
    this.initialization ??= (async () => {
      for (const job of await this.store.list()) {
        this.jobs.set(job.id, job);
        if (job.state === "extracting") { job.state = "failed"; job.error = "The server restarted during extraction. Retry the PDF; no partial map was accepted."; }
        if (job.busy) { delete job.busy; job.warnings.push("AI analysis was interrupted by a server restart."); }
        await this.store.save(job);
      }
    })(); await this.initialization;
  }
  async list(projectId: string) { await this.initialize(); return [...this.jobs.values()].filter((job) => job.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async get(id: string) { await this.initialize(); const job = this.jobs.get(id); if (!job) throw new ProjectServiceError(404, "Document map not found"); return job; }
  async settings() { return { settings: await this.store.settings(), available: providerAvailability() }; }
  async setSettings(raw: unknown) { const settings = settingsSchema.parse(raw); for (const profile of Object.values(settings)) checkProfile(profile); await this.store.setSettings(settings); return this.settings(); }
  private launch(job: ModbusAIJob, work: () => Promise<void>) {
    const task = work().catch(async (error) => { job.error = message(error); if (job.state === "extracting") job.state = "failed"; }).finally(async () => { delete job.busy; await this.store.save(job); this.tasks.delete(job.id); });
    this.tasks.set(job.id, task);
  }
  async settled(id: string) { await this.tasks.get(id); }
  async start(projectId: string, file: File): Promise<ModbusAIJob> {
    await this.initialize();
    const view = await this.getView(projectId); if (view.family !== "knx-mbm") throw new ProjectServiceError(422, "PDF device maps require a KNX–Modbus Master project.");
    if (!/\.pdf$/i.test(file.name) || file.size > 20 * 1024 * 1024 || !file.size) throw new ProjectServiceError(422, "Choose a PDF up to 20 MB.");
    const settings = await this.store.settings(); requireCredential(settings.extraction);
    const bytes = new Uint8Array(await file.arrayBuffer()); if (!Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from("%PDF-"))) throw new ProjectServiceError(422, "File is not a PDF.");
    const id = randomUUID(); const at = new Date().toISOString();
    const job: ModbusAIJob = { id, projectId, revision: 0, state: "extracting", createdAt: at, updatedAt: at, fileName: file.name.slice(0, 200), sourceHash: createHash("sha256").update(bytes).digest("hex"), manufacturer: "", model: "", profile: settings.extraction, pages: [], signals: [], warnings: [], progress: "Reading source pages", runs: [], experiments: [], analyses: [] };
    await this.store.savePdf(id, bytes); await this.store.save(job); this.jobs.set(id, job);
    this.launch(job, () => this.extract(job, bytes)); return job;
  }
  private async extract(job: ModbusAIJob, bytes: Uint8Array) {
    job.pages = await extractPdfEvidencePages({ arrayBuffer: async () => bytes.slice().buffer });
    await this.store.save(job);
    const document = await PDFDocument.load(bytes); const combined: RawExtraction = { manufacturer: null, model: null, globalNotes: [], tables: [] };
    const chunkSize = 15; const rawChunks: RawExtraction[] = [];
    for (let start = 0; start < job.pages.length; start += chunkSize) {
      const pages = job.pages.slice(start, start + chunkSize);
      job.progress = `Extracting pages ${pages[0].page}–${pages.at(-1)!.page} of ${job.pages.length}`; await this.store.save(job);
      const out = await PDFDocument.create(); const copied = await out.copyPages(document, pages.map((page) => page.page - 1)); copied.forEach((page) => out.addPage(page));
      const pdf = await out.save(); const text = pages.map((page) => `ORIGINAL PAGE ${page.page}\n${page.text}`).join("\n\n");
      if (job.profile.provider === "kimi" && pages.every((p) => p.text.trim().length < 20)) throw new ProjectServiceError(422, "This PDF section has no extractable text. Select OpenAI or Claude for native PDF vision.");
      const raw = await this.generate({ profile: job.profile, schema: rawExtractionSchema, system: EXTRACTION_PROMPT,
        text: `Original document pages ${pages.map((p) => p.page).join(", ")}. The PDF chunk starts at original page ${pages[0].page}; preserve original page numbers.\n${text}`,
        pdf: job.profile.provider === "kimi" ? undefined : pdf, maxTokens: 24000 });
      rawChunks.push(raw); combined.manufacturer ??= raw.manufacturer; combined.model ??= raw.model; combined.tables.push(...raw.tables); combined.globalNotes!.push(...raw.globalNotes ?? []);
    }
    await this.store.writer.write(job.id, "raw-extraction.json", JSON.stringify(rawChunks));
    const normalized = normalizeExtraction(combined, job.pages);
    job.signals = normalized.signals.map((row) => candidateSchema.parse(row)); job.warnings = [...normalized.warnings];
    job.manufacturer = combined.manufacturer ?? ""; job.model = combined.model ?? "";
    job.state = "ready"; job.progress = `Extracted ${job.signals.length} candidate signals. Review before import.`;
  }
  private assertRevision(job: ModbusAIJob, revision: number) { if (job.revision !== revision) throw new ProjectServiceError(409, "This document map changed. Reload before editing or validating."); }
  async update(id: string, revision: number, raw: unknown) {
    return this.exclusive(id, () => this.updateUnlocked(id, revision, raw));
  }
  // Import, map edits and capture startup share this lock. A paid analysis is
  // reserved before releasing it, so concurrent requests cannot duplicate it.
  async exclusive<T>(id: string, work: () => Promise<T>): Promise<T> { return withProjectLock(`modbus-ai:${id}`, work); }
  private async updateUnlocked(id: string, revision: number, raw: unknown) {
    const job = await this.get(id); this.assertRevision(job, revision);
    if (job.state !== "ready" || job.busy || this.tasks.has(id)) throw new ProjectServiceError(409, "Wait for extraction or analysis to finish before editing.");
    if (job.runs.length) { const current = await this.scans.get(job.runs.at(-1)!.scanId); if (!isScanTerminal(current.state)) throw new ProjectServiceError(409, "Finish capture and restoration before changing the map."); }
    const rows = candidateSchema.array().max(4096).parse(raw);
    if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new ProjectServiceError(422, "Signal IDs must be unique.");
    job.signals = rows; job.revision++; delete job.error; await this.store.save(job); return job;
  }
  async startValidation(id: string, revision: number, input: Omit<ScanInput, "projectId" | "ranges" | "targets">) {
    return this.exclusive(id, async () => {
    const job = await this.get(id); this.assertRevision(job, revision);
    if (job.state !== "ready" || job.busy) throw new ProjectServiceError(409, "Finish extraction or analysis before live validation.");
    if (job.runs.length) { const current = await this.scans.get(job.runs.at(-1)!.scanId); if (!isScanTerminal(current.state) || current.needsRestore) throw new ProjectServiceError(409, "Finish capture and restoration before starting another capture."); }
    const targets = validationTargets(job.signals); if (!targets.length) throw new ProjectServiceError(422, "Select readable signals. Write-only and Trigger rows are not probed.");
    const scan = await this.scans.start({ ...input, projectId: job.projectId, ranges: [], targets });
    job.runs.push({ scanId: scan.id, revision, signalIds: job.signals.filter((row) => row.enabled && row.access !== "W" && row.access !== "Trigger").map((row) => row.id), startedAt: scan.createdAt, fingerprint: scan.targetFingerprint! });
    await this.store.save(job); return { job, scan };
    });
  }
  async addExperiment(id: string, revision: number, raw: unknown) {
    return this.exclusive(id, async () => {
    const job = await this.get(id); this.assertRevision(job, revision); const experiment = experimentSchema.parse(raw);
    const run = job.runs.at(-1); if (!run || run.revision !== revision || !run.signalIds.includes(experiment.signalId)) throw new ProjectServiceError(422, "Choose a signal in the current capture.");
    const scan = await this.scans.get(run.scanId);
    if (experiment.at < scan.createdAt || Date.parse(experiment.at) > Date.now() || (isScanTerminal(scan.state) && experiment.at > scan.updatedAt)) throw new ProjectServiceError(422, "Record the actual change time within this capture.");
    job.experiments.push({ ...experiment, id: randomUUID(), revision, scanId: scan.id }); await this.store.save(job); return job;
    });
  }
  async report(id: string) {
    const job = structuredClone(await this.get(id)); const runs = job.runs.filter((run) => run.revision === job.revision);
    const results = new Map<string, ValidationResult>(); let scan;
    for (const run of runs) {
      const current = await this.scans.get(run.scanId); scan = current;
      const rows = job.signals.filter((row) => run.signalIds.includes(row.id));
      for (const result of validateSignals(rows, current, job.experiments, job.revision)) results.set(result.signalId, result);
    }
    return { job, scan, validation: [...results.values()], scope: "Read-only Modbus evidence. Write/Trigger access and KNX end-to-end delivery remain untested." };
  }
  async analyze(id: string, revision: number, task: Exclude<AITask, "extraction">, automatic = false) {
    return this.exclusive(id, async () => {
    const job = await this.get(id); this.assertRevision(job, revision);
    if (job.state !== "ready" || job.busy || this.tasks.has(id)) throw new ProjectServiceError(409, "An AI operation is already in progress.");
    const settings = await this.store.settings(); const profile = settings[task]; requireCredential(profile);
    const report = await this.report(id); const started = Date.now();
    if (automatic) {
      const used = job.automaticAttempts?.[report.scan?.id ?? ""] ?? 0;
      if (task !== "diagnosis" || !report.scan || report.scan.state !== "scanning") throw new ProjectServiceError(409, "Automatic diagnosis requires a running capture.");
      if (used >= MAX_AUTOMATIC_ANALYSES) throw new ProjectServiceError(429, `Automatic diagnosis is limited to ${MAX_AUTOMATIC_ANALYSES} analyses per capture.`);
    }
    const lastAnalysis = job.analyses.at(-1); if (lastAnalysis && Date.now() - Date.parse(lastAnalysis.at) < 5000) throw new ProjectServiceError(429, "Wait five seconds between analyses.");
    const signals = job.signals.filter((row) => task === "review" || row.enabled);
    // Bounded evidence windows keep analysis asynchronous and independent of capture.
    const recent = report.scan?.observations?.slice(-200) ?? [];
    const evidence = { revision, manufacturer: job.manufacturer, model: job.model, signals, validation: report.validation, scanId: report.scan?.id,
      scanState: report.scan?.state, observations: recent, observationsTruncated: report.scan?.observationsTruncated ?? false,
      experiments: job.experiments.filter((e) => e.revision === revision),
      sourcePages: task === "review" ? job.pages : job.pages.filter((p) => signals.some((r) => r.sourcePages.includes(p.page))).slice(0, 10) };
    const text = JSON.stringify(evidence); if (text.length > 750000) throw new ProjectServiceError(422, "Map is too large for one analysis. Disable unrelated signals or restrict the document.");
    job.busy = task; delete job.error;
    if (automatic) { job.automaticAttempts ??= {}; job.automaticAttempts[report.scan!.id] = (job.automaticAttempts[report.scan!.id] ?? 0) + 1; }
    await this.store.save(job);
    this.launch(job, async () => {
      const analysis = await this.generate({ profile, schema: analysisSchema, system: DIAGNOSIS_PROMPT, text, maxTokens: 10000 });
      const known = new Set(job.signals.map((r) => r.id));
      if (analysis.findings.some((f) => f.signalId !== null && !known.has(f.signalId)) || analysis.corrections.some((c) => !known.has(c.signalId))) throw new ProjectServiceError(422, "AI referenced unknown signals; analysis was rejected.");
      const corrections = analysis.corrections.flatMap((proposal) => {
        const row = job.signals.find((r) => r.id === proposal.signalId)!;
        const checked = normalizeCorrection(row, proposal);
        if (checked) return [checked];
        analysis.findings.push({ signalId: row.id, severity: "warning", claim: `Invalid AI proposal for ${proposal.field} was omitted.`, evidence: [proposal.reason], confidence: "low", nextCheck: "Review this field manually against the source PDF." });
        return [];
      });
      job.analyses.push({ ...analysis, corrections, id: randomUUID(), task, profile, at: new Date().toISOString(), revision, scanId: report.scan?.id, latencyMs: Date.now() - started, automatic });
      if (job.analyses.length > 100) job.analyses.shift();
    }); return job;
    });
  }
  async applyCorrection(id: string, revision: number, analysisId: string, correctionIndex: number) {
    return this.exclusive(id, async () => {
    const job = await this.get(id); this.assertRevision(job, revision);
    const analysis = job.analyses.find((a) => a.id === analysisId && a.revision === revision); const correction = analysis?.corrections[correctionIndex];
    if (!correction) throw new ProjectServiceError(422, "Correction is missing or based on an older map.");
    const rows = structuredClone(job.signals); const row = rows.find((r) => r.id === correction.signalId)!;
    const checked = normalizeCorrection(row, correction); if (!checked) throw new ProjectServiceError(422, "This correction is not a valid MAPS value. Review the field manually.");
    const numeric = ["address", "function", "scale", "offset"].includes(checked.field);
    Object.assign(row, { [checked.field]: numeric ? Number(checked.value) : checked.value, reviewed: false });
    row.warnings.push(`User accepted AI proposal: ${correction.reason}. Revalidate against the device.`);
    return this.updateUnlocked(id, revision, rows);
    });
  }
  async assertImport(id: string, revision: number, selected: string[]) {
    const job = await this.get(id); this.assertRevision(job, revision);
    if (job.state !== "ready" || job.busy) throw new ProjectServiceError(409, "Wait for extraction or analysis to finish.");
    for (const run of job.runs) { const scan = await this.scans.get(run.scanId); if (!isScanTerminal(scan.state) || scan.needsRestore) throw new ProjectServiceError(409, "Complete capture and restore the gateway before importing."); }
    const rows = job.signals.filter((row) => selected.includes(row.id));
    if (!rows.length || rows.length !== new Set(selected).size || rows.some((r) => !r.reviewed || /32|64/.test(r.dataType) && !r.byteOrder)) throw new ProjectServiceError(422, "Select reviewed signals and resolve multi-register byte order before import.");
    return { job, rows };
  }
  async verifyTarget(job: ModbusAIJob, input: ScanInput) {
    const latest = job.runs.filter((run) => run.revision === job.revision).at(-1);
    if (latest) {
      const scan = await this.scans.get(latest.scanId);
      if (scan.input.slave !== input.slave || scan.input.locator.kind !== input.locator.kind || scan.input.locator.nodeIndex !== input.locator.nodeIndex || nodeFingerprint(await this.getView(job.projectId), input) !== latest.fingerprint) throw new ProjectServiceError(409, "Validation belongs to a different connection or slave. Revalidate this target before importing.");
    }
  }
}
const globals = globalThis as unknown as { __mapsModbusAI?: ModbusAIService };
export function getModbusAIService() { return globals.__mapsModbusAI ??= new ModbusAIService(); }
