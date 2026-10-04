import "server-only";
import { getPreviewTemplate, rememberTemplateUndo, templateUndoXml } from "@/server/device-templates/cache";
import {
  buildCompleteBlob,
  buildProjectZip,
  compareMapsVersions,
  extractIbmaps,
  isMapsVersion,
  MAPS_REFERENCE_VERSION,
  parseCompleteBlob,
  projectMapsVersion,
  XmlDocument,
} from "@/core/project-format";
import type { KnxMbmProject } from "@/gateway-families/knx-mbm";
import { projectFromXml as knxMbmProjectFromXml } from "@/gateway-families/knx-mbm";
import { addDevice as addScanDevice, updateDevice as updateScanDevice, addSignal as addScanSignal, updateSignal as updateScanSignal } from "@/gateway-families/knx-mbm/xml-ops";
import { MAX_ACTIVE_SIGNALS, MAX_TOTAL_SIGNAL_ROWS } from "@/core/signals/model";
import type { ScanInput, ScanResult } from "@/core/modbus-scan/model";
import type { CandidateSignal } from "@/core/modbus-ai/model";
import { appendCandidateSignals } from "@/server/modbus-ai/template";
import type { MeMbsProject } from "@/gateway-families/me-mbs";
import { projectFromXml as meMbsProjectFromXml } from "@/gateway-families/me-mbs";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { SYNTHETIC_ME_MBS_XML } from "@/gateway-families/me-mbs/fixtures/synthetic-project";
import type { MbsKnxProject } from "@/gateway-families/mbs-knx";
import { projectFromXml as mbsKnxProjectFromXml } from "@/gateway-families/mbs-knx";
import { MAPS_MBS_KNX_TEMPLATE_XML } from "@/gateway-families/mbs-knx/fixtures/maps-template";
import type { ValidationIssue } from "@/core/validation/issue";
import { getProjectStore } from "../persistence";
import { getGatewaySessionManager } from "../intesis-transport";
import type { ProjectHistoryEntry, ProjectMeta, ProjectSource } from "../persistence/types";
import { buildKnxEsf } from "../exports/esf-knx";
import { buildPollPlanXlsx } from "../exports/xlsx-poll-plan";
import { buildSignalsXlsx } from "../exports/xlsx-signals";
import { applySignalsXlsx, type ImportMode } from "../imports/xlsx-signals";
import { ProjectServiceError } from "./errors";
import { withProjectLock } from "./project-lock";
import { hasValidProjectPassword } from "./password";
import {
  detectFamily,
  familyById,
  normalizeProject,
  normalizeProjectXml,
  unsupportedProjectMessage,
  type FamilyId,
  type ProjectPatch,
} from "./families";

export { ProjectServiceError } from "./errors";
export type {
  DevicePatch,
  FamilyId,
  KnxMbmPatch,
  MeMbsPatch,
  ProjectPatch,
  RtuNodePatch,
  TcpNodePatch,
} from "./families";

interface ProjectViewBase {
  /** MAPS deploy integrity check; never the password itself. */
  passwordValid: boolean;
  /** MAPS version that last saved the project (`<Header Version>`): the default target of exported MAPS files. */
  mapsVersion: string;
  meta: ProjectMeta;
  issues: ValidationIssue[];
  /** Whether the original gateway "complete" blob is available for round-trip. */
  hasCompleteBlob: boolean;
}

/** Family-discriminated project view: `family` selects the model type. */
export type ProjectView =
  | (ProjectViewBase & { family: "knx-mbm"; project: KnxMbmProject })
  | (ProjectViewBase & { family: "me-mbs"; project: MeMbsProject })
  | (ProjectViewBase & { family: "mbs-knx"; project: MbsKnxProject });

export async function listProjects(): Promise<ProjectMeta[]> {
  const store = getProjectStore();
  const metas = await store.list();
  // Backfill the family field for projects stored before it existed.
  return Promise.all(metas.map(async (meta) => withRevision(await withFamily(store, meta))));
}

// Like live gateway sessions, deploy claims must survive Next.js route reloads.
const globalForDeploys = globalThis as unknown as {
  __mapsActiveProjectDeploys?: Set<string>;
};
const activeDeploys = globalForDeploys.__mapsActiveProjectDeploys ??= new Set<string>();

/** Claim the project before deploy gates/read/upload so deletion cannot race it. */
export async function beginProjectDeploy(id: string): Promise<() => void> {
  const store = getProjectStore();
  const key = store.storageId(id);
  await withProjectLock(key, async () => {
    if (!await store.get(id)) throw new ProjectServiceError(404, `Project "${id}" not found`);
    if (activeDeploys.has(key)) {
      throw new ProjectServiceError(409, "This project is already being uploaded.", "project-uploading");
    }
    activeDeploys.add(key);
  });
  return () => { activeDeploys.delete(key); };
}

/** Remove the complete local project, including its history and received blob. */
export async function deleteProject(id: string): Promise<void> {
  const store = getProjectStore();
  const key = store.storageId(id);
  await withProjectLock(key, async () => {
    if (!await store.get(id)) throw new ProjectServiceError(404, `Project "${id}" not found`);
    if (activeDeploys.has(key)) {
      throw new ProjectServiceError(409, "This project is being uploaded. Wait for the upload to finish.", "project-uploading");
    }
    if (getGatewaySessionManager().list().some((session) =>
      session.projectId && store.storageId(session.projectId) === key)) {
      throw new ProjectServiceError(409, "This project is open in a gateway session. Disconnect or switch projects first.", "project-in-session");
    }
    await store.deleteProject(id);
  });
}

export async function getProjectView(id: string): Promise<ProjectView> {
  return readProjectView(id, { locked: false });
}

/**
 * The project view together with the exact XML it was built from (normalized
 * like `readProjectXml`): what the deploy validates is what it sends.
 */
export async function getProjectSnapshot(id: string): Promise<{ view: ProjectView; xml: string }> {
  return readProjectSnapshot(id, { locked: false });
}

/** `locked`: the caller already holds the project lock (writes return the new view). */
async function readProjectView(id: string, options: { locked: boolean }): Promise<ProjectView> {
  return (await readProjectSnapshot(id, options)).view;
}

async function readProjectSnapshot(
  id: string,
  { locked }: { locked: boolean },
): Promise<{ view: ProjectView; xml: string }> {
  const store = getProjectStore();
  const stored = await store.get(id);
  if (!stored) throw new ProjectServiceError(404, `Project "${id}" not found`);
  // A family backfill rewrites the meta, so that read (meta + XML) happens
  // entirely under the lock: otherwise a newer meta could pair with an older XML.
  if (!stored.family && !locked) {
    return withProjectLock(store.storageId(id), () => readProjectSnapshot(id, { locked: true }));
  }
  const storedXml = await store.readXml(id);
  const doc = XmlDocument.parse(storedXml);
  if (!detectFamily(doc)) throw new ProjectServiceError(422, unsupportedProjectMessage(doc));
  const xml = normalizeProject(doc) ? doc.serialize() : storedXml;
  const meta = withRevision(await withFamily(store, stored, doc, true));
  const hasCompleteBlob = await store.hasCompleteBlob(id);
  const base = { meta, hasCompleteBlob, passwordValid: hasValidProjectPassword(doc), mapsVersion: projectMapsVersion(doc) };
  if (meta.family === "mbs-knx") {
    const project = mbsKnxProjectFromXml(doc);
    return { xml, view: { ...base, family: "mbs-knx", project, issues: familyById("mbs-knx").validate(project) } };
  }
  if (meta.family === "me-mbs") {
    const project = meMbsProjectFromXml(doc);
    return { xml, view: { ...base, family: "me-mbs", project, issues: familyById("me-mbs").validate(project) } };
  }
  const project = knxMbmProjectFromXml(doc);
  return { xml, view: { ...base, family: "knx-mbm", project, issues: familyById("knx-mbm").validate(project) } };
}

/** Open a local .ibmaps XML text as a project. */
export async function openIbmaps(
  xml: string,
  opts: { id: string; name?: string; source?: ProjectSource; completeBlob?: Uint8Array },
): Promise<ProjectMeta> {
  const doc = XmlDocument.parse(xml);
  const family = detectFamily(doc);
  if (!family) throw new ProjectServiceError(422, unsupportedProjectMessage(doc));
  // Stored as MAPS saves it once loaded.
  const stored = normalizeProject(doc) ? doc.serialize() : xml;
  return persistNewProject(opts.id, stored, family.id, {
    name: opts.name ?? opts.id,
    source: opts.source ?? "file",
    completeBlob: opts.completeBlob,
  });
}

/** Open a gateway "complete" blob: validates length/CRC32/ZIP and extracts the XML. */
export async function openCompleteBlob(
  data: Uint8Array,
  opts: { id: string; name?: string; source?: ProjectSource },
): Promise<ProjectMeta> {
  const blob = parseCompleteBlob(data); // throws on bad length/CRC
  const ibmaps = extractIbmaps(blob.zip);
  return openIbmaps(ibmaps.xml, { ...opts, name: opts.name ?? ibmaps.name, completeBlob: data });
}

/** Explicit demo project from the synthetic fixture — always labelled demo. */
export async function loadDemoProject(): Promise<ProjectMeta> {
  return persistNewProject("demo", SYNTHETIC_KNX_MBM_XML, "knx-mbm", {
    name: "Demo project (synthetic)",
    source: "demo",
  });
}

/** Create a local project from one of the supported family templates. */
export async function createTemplateProject(
  family: FamilyId,
  name: string,
): Promise<ProjectMeta> {
  const id = `project-${Date.now().toString(36)}`;
  const xml =
    family === "me-mbs" ? SYNTHETIC_ME_MBS_XML : family === "mbs-knx" ? MAPS_MBS_KNX_TEMPLATE_XML : SYNTHETIC_KNX_MBM_XML;
  return persistNewProject(id, xml, family, { name, source: "template" });
}

/**
 * Apply a batch atomically under the project lock. With `expectedRevision`,
 * the batch is rejected with 409 "revision-conflict" when the project changed
 * since the caller read it (the webapp sends it as `If-Match`).
 */
export async function applyPatches(
  id: string,
  patches: ProjectPatch[],
  options: { expectedRevision?: number } = {},
): Promise<ProjectView> {
  const store = getProjectStore();
  return withProjectLock(store.storageId(id), async () => {
    const stored = await store.get(id);
    if (!stored) throw new ProjectServiceError(404, `Project "${id}" not found`);
    if (options.expectedRevision !== undefined && options.expectedRevision !== revisionOf(stored)) {
      throw new ProjectServiceError(
        409,
        "The project was changed elsewhere since it was loaded. Reload it and try again.",
        "revision-conflict",
      );
    }
    const originalXml = await store.readXml(id);
    let doc = XmlDocument.parse(originalXml);
    const family = detectFamily(doc);
    if (!family) throw new ProjectServiceError(422, unsupportedProjectMessage(doc));
    for (const patch of patches) {
      if (!family.accepts(patch)) {
        throw new ProjectServiceError(
          409,
          `Patch "${patch.type}" does not apply to a ${family.displayName} project.`,
        );
      }
    }
    const templatePatch = patches.find((patch) => patch.type === "applyDeviceTemplate" || patch.type === "undoDeviceTemplate");
    if (templatePatch) {
      if (patches.length !== 1) throw new ProjectServiceError(422, "Import or undo a device template in a separate request.");
      if (templatePatch.type === "applyDeviceTemplate") getPreviewTemplate(templatePatch.token, id, revisionOf(stored));
      if (templatePatch.type === "undoDeviceTemplate") doc = XmlDocument.parse(templateUndoXml(templatePatch.token, id, revisionOf(stored)));
    }
    normalizeProject(doc);
    family.applyPatches(doc, patches);
    const nextXml = doc.serialize();
    if (patches.length === 1 && patches[0].type === "moveSignal" && nextXml === originalXml) {
      return readProjectView(id, { locked: true });
    }
    await store.writeXml(id, nextXml);
    await store.upsert(nextRevision(stored));
    await snapshotDraft(id, templatePatch?.type === "applyDeviceTemplate" ? `Imported Modbus device ${templatePatch.name}` : templatePatch?.type === "undoDeviceTemplate" ? "Undid device template import" : "Edited project");
    if (templatePatch?.type === "applyDeviceTemplate") rememberTemplateUndo(templatePatch.token, originalXml);
    return readProjectView(id, { locked: true });
  });
}

/** Import confirmed reads into the local draft only; no gateway deployment. */
export async function addScannedSignals(id: string, input: ScanInput, rows: ScanResult[], expectedRevision: number, fingerprint: string): Promise<ProjectView> {
  const store = getProjectStore();
  return withProjectLock(store.storageId(id), async () => {
    const stored = await store.get(id);
    if (!stored) throw new ProjectServiceError(404, "Project not found");
    if (revisionOf(stored) !== expectedRevision) throw new ProjectServiceError(409, "The project changed. Reload it before adding scan results.", "revision-conflict");
    const doc = XmlDocument.parse(await store.readXml(id)); normalizeProject(doc);
    if (detectFamily(doc)?.id !== "knx-mbm") throw new ProjectServiceError(422, "Scan results require a KNX–MBM project.");
    const project = knxMbmProjectFromXml(doc);
    const node = input.locator.kind === "rtu" ? project.mbm.rtuNodes[input.locator.nodeIndex] : project.mbm.tcpNodes[input.locator.nodeIndex];
    if (!node || JSON.stringify(Object.fromEntries(Object.entries(node).filter(([key]) => key !== "devices"))) !== fingerprint) throw new ProjectServiceError(409, "The scanned connection settings changed. Scan this connection again.");
    let deviceIndex = node.devices.findIndex((device) => device.slave === input.slave);
    if (deviceIndex < 0) { deviceIndex = addScanDevice(doc, input.locator); updateScanDevice(doc, { ...input.locator, deviceIndex }, { slave: input.slave, name: `Scanned slave ${input.slave}`, enabled: true, baseRegister: 0 }); }
    const base = node.devices[deviceIndex]?.baseRegister ?? 0;
    const port = input.locator.kind === "rtu" ? input.locator.nodeIndex : project.mbm.rtuNodes.length + input.locator.nodeIndex;
    const existing = new Set(project.signals.filter((s) => s.modbus.port === port && s.modbus.deviceIndex === deviceIndex).map((s) => `${s.modbus.readFunc}:${s.modbus.address}`));
    const selected = rows.filter((row) => !existing.has(`${row.function}:${row.address + base}`));
    if (!selected.length) throw new ProjectServiceError(409, "These function/address pairs already exist on this device.");
    if (project.signals.filter((s) => s.active).length + selected.length > MAX_ACTIVE_SIGNALS || project.signals.length + selected.length > MAX_TOTAL_SIGNAL_ROWS) throw new ProjectServiceError(422, "Selected results exceed the project signal capacity.");
    const used = new Set(project.signals.map((s) => s.knx.groupAddress)); let ga = 1;
    for (const row of selected) {
      if (!row.samples || row.lastValue === undefined) throw new ProjectServiceError(422, "Only successfully read addresses can be added.");
      if (row.address + base > 65535) throw new ProjectServiceError(422, "The address exceeds this device's address range after base conversion.");
      while (used.has(ga)) ga++;
      if (ga > 0x7fff) throw new ProjectServiceError(422, "No free KNX group address available."); used.add(ga);
      const signalId = addScanSignal(doc); const bit = row.function <= 2;
      updateScanSignal(doc, signalId, { active: true, description: `Scanned slave ${input.slave} FC0${row.function} PDU ${row.address}`, knx: { dpt: bit ? 0x0101 : 0x0701, groupAddress: ga, additionalAddresses: [], flags: { r: true, t: false, ri: false, w: false, u: false } }, modbus: { port, deviceIndex, isBroadcast: false, readFunc: row.function, writeFunc: -1, lenBits: bit ? 1 : 16, format: bit ? -1 : 0, byteOrder: bit ? -1 : 0, bit: -1, numOfBits: -1, address: row.address + base, deadband: 0 } });
    }
    const next = knxMbmProjectFromXml(doc);
    const addedIds = new Set(next.signals.slice(project.signals.length).map((s) => s.id));
    const errors = familyById("knx-mbm").validate(next).filter((issue) => issue.severity === "error" && issue.ref?.id !== undefined && addedIds.has(Number(issue.ref.id)));
    if (errors.length) throw new ProjectServiceError(422, errors.map((issue) => issue.message).join("; "));
    await store.writeXml(id, doc.serialize()); await store.upsert(nextRevision(stored));
    await snapshotDraft(id, `Added ${selected.length} read-only Modbus scan results`);
    return readProjectView(id, { locked: true });
  });
}

export async function addDocumentSignals(id: string, rows: CandidateSignal[], target: { kind: "rtu" | "tcp"; nodeIndex: number; slave: number; name: string; manufacturer: string }, expectedRevision: number, fingerprint: string): Promise<ProjectView> {
  const store = getProjectStore();
  return withProjectLock(store.storageId(id), async () => {
    const stored = await store.get(id); if (!stored) throw new ProjectServiceError(404, "Project not found");
    if (revisionOf(stored) !== expectedRevision) throw new ProjectServiceError(409, "The project changed. Reload before importing the map.", "revision-conflict");
    const doc = XmlDocument.parse(await store.readXml(id)); normalizeProject(doc);
    if (detectFamily(doc)?.id !== "knx-mbm") throw new ProjectServiceError(422, "Document maps require KNX–Modbus Master.");
    const project = knxMbmProjectFromXml(doc); const node = target.kind === "rtu" ? project.mbm.rtuNodes[target.nodeIndex] : project.mbm.tcpNodes[target.nodeIndex];
    if (!node || JSON.stringify(Object.fromEntries(Object.entries(node).filter(([key]) => key !== "devices"))) !== fingerprint) throw new ProjectServiceError(409, "Connection settings changed. Review the target before import.");
    appendCandidateSignals(doc, rows, target);
    await store.writeXml(id, doc.serialize()); await store.upsert(nextRevision(stored));
    await snapshotDraft(id, `Added ${rows.length} reviewed PDF map signals (Modbus writes disabled)`);
    return readProjectView(id, { locked: true });
  });
}

/**
 * The project XML as MAPS would save it after loading it (`normalizeProject`):
 * what exports and the deploy send. The stored text itself when nothing changes.
 */
export async function readProjectXml(id: string): Promise<string> {
  return normalizeProjectXml(await getProjectStore().readXml(id));
}

/** Rebuild the "complete" blob with the current XML and the ORIGINAL XBL. */
export async function exportCompleteBlob(id: string): Promise<Uint8Array> {
  const store = getProjectStore();
  const xml = await readProjectXml(id);
  const zip = buildProjectZip(`${id}.ibmaps`, xml);
  if (await store.hasCompleteBlob(id)) {
    const original = parseCompleteBlob(await store.readCompleteBlob(id));
    return buildCompleteBlob(original.xbl, zip);
  }
  // No XBL available (file-opened projects): export is the ZIP alone.
  return zip;
}

/**
 * Return the meta with its family guaranteed: stored metas from before the
 * family field existed are backfilled by detection (they could only have been
 * KNX–MBM, which is also the fallback when detection fails) and re-persisted.
 */
async function withFamily(
  store: ReturnType<typeof getProjectStore>,
  meta: ProjectMeta,
  doc?: XmlDocument,
  locked = false,
): Promise<ProjectMeta> {
  const family = meta.family as FamilyId | undefined;
  if (family) return meta;
  const backfill = async () => {
    // Re-read under the lock so the backfill never rolls back a newer write.
    const current = (await store.get(meta.id)) ?? meta;
    if (current.family) return current;
    const parsed = doc ?? XmlDocument.parse(await store.readXml(meta.id));
    const upgraded = { ...current, family: detectFamily(parsed)?.id ?? "knx-mbm" };
    // Metadata backfill only: the project itself is unchanged, so no new revision.
    await store.upsert(upgraded);
    return upgraded;
  };
  return locked ? backfill() : withProjectLock(store.storageId(meta.id), backfill);
}

async function persistNewProject(
  id: string,
  xml: string,
  family: FamilyId,
  opts: { name: string; source: ProjectSource; completeBlob?: Uint8Array },
): Promise<ProjectMeta> {
  const store = getProjectStore();
  return withProjectLock(store.storageId(id), async () => {
    // Re-opening an existing id replaces the project, so its revision moves on.
    const existing = await store.get(id);
    const meta: ProjectMeta = {
      id,
      name: opts.name,
      description: XmlDocument.parse(xml).getAttr([], "ProjectDescription") ?? "",
      source: opts.source,
      family,
      updatedAt: new Date().toISOString(),
      revision: existing ? revisionOf(existing) + 1 : 1,
    };
    await store.writeXml(id, xml);
    if (opts.completeBlob) await store.writeCompleteBlob(id, opts.completeBlob);
    await store.upsert(meta);
    return meta;
  });
}

const revisionOf = (meta: ProjectMeta) => meta.revision ?? 0;

/** Clients always receive an explicit revision (legacy metas are revision 0). */
const withRevision = (meta: ProjectMeta): ProjectMeta => ({ ...meta, revision: revisionOf(meta) });

/** Meta for a write that changed the project: new revision and timestamp. */
function nextRevision(meta: ProjectMeta, changes: Partial<ProjectMeta> = {}): ProjectMeta {
  return { ...meta, ...changes, updatedAt: new Date().toISOString(), revision: revisionOf(meta) + 1 };
}

/**
 * The signals table in the MAPS format. `mapsVersion` is the MAPS version that
 * will import it (B3; MAPS only accepts its own), by default the project's.
 */
export async function exportSignalsXlsx(
  id: string,
  opts: { mapsVersion?: string } = {},
): Promise<{ filename: string; body: Buffer; contentType: string }> {
  const view = await getProjectView(id);
  const mapsVersion = opts.mapsVersion?.trim() || view.mapsVersion;
  if (!isMapsVersion(mapsVersion)) {
    throw new ProjectServiceError(422, `"${mapsVersion}" is not a MAPS version: use four numbers, such as ${MAPS_REFERENCE_VERSION}.`);
  }
  const body = await buildSignalsXlsx(view, { mapsVersion });
  return {
    filename: `${safeDownloadName(view.meta.name)} signals.xlsx`,
    body,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

export async function exportEsf(id: string): Promise<{ filename: string; body: string }> {
  const view = await getProjectView(id);
  if (view.family !== "knx-mbm") {
    throw new ProjectServiceError(422, "ESF export is only available for KNX ↔ Modbus Master projects.");
  }
  return { filename: `${safeDownloadName(view.meta.name)}.esf`, body: buildKnxEsf(view.project) };
}

export async function exportPollPlanXlsx(
  id: string,
): Promise<{ filename: string; body: Buffer; contentType: string }> {
  const view = await getProjectView(id);
  if (view.family !== "knx-mbm") {
    throw new ProjectServiceError(422, "Poll plan export is only available for KNX ↔ Modbus Master projects.");
  }
  const xml = await readProjectXml(id);
  const body = await buildPollPlanXlsx(XmlDocument.parse(xml), { projectName: view.meta.name });
  return {
    filename: `${safeDownloadName(view.meta.name)} poll-plan.xlsx`,
    body,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

export async function importSignalsXlsx(
  id: string,
  data: Uint8Array,
  fileName: string,
  mode: ImportMode = "add",
): Promise<ProjectView> {
  const store = getProjectStore();
  return withProjectLock(store.storageId(id), async () => {
    const stored = await store.get(id);
    if (!stored) throw new ProjectServiceError(404, `Project "${id}" not found`);
    const doc = XmlDocument.parse(await store.readXml(id));
    const family = detectFamily(doc);
    if (!family) throw new ProjectServiceError(422, unsupportedProjectMessage(doc));
    normalizeProject(doc);
    const result = await applySignalsXlsx(doc, family.id, data, mode);
    await store.writeXml(id, doc.serialize());
    const now = new Date().toISOString();
    const warning = newerMapsWarning(result.fileVersion);
    await store.upsert(
      nextRevision(stored, {
        lastImport: { fileName, at: now, rows: result.rows, mode, ...(warning ? { warning } : {}) },
      }),
    );
    await snapshotDraft(id, mode === "replace" ? `Replaced signals from ${fileName}` : `Imported ${fileName}`);
    return readProjectView(id, { locked: true });
  });
}

/** A file from a MAPS newer than the reference may hold what MAPS Web does not know yet. */
function newerMapsWarning(fileVersion: string | undefined): string | undefined {
  if (!fileVersion || !isMapsVersion(fileVersion)) return undefined;
  if (compareMapsVersions(fileVersion, MAPS_REFERENCE_VERSION) <= 0) return undefined;
  return `This file comes from MAPS ${fileVersion}, newer than MAPS ${MAPS_REFERENCE_VERSION}, the version MAPS Web was checked against. Review the imported signals.`;
}

export async function listProjectHistory(id: string): Promise<ProjectHistoryEntry[]> {
  const store = getProjectStore();
  if (!(await store.get(id))) throw new ProjectServiceError(404, `Project "${id}" not found`);
  return store.listHistory(id);
}

export async function restoreProjectHistory(id: string, entryId: string): Promise<ProjectView> {
  const store = getProjectStore();
  return withProjectLock(store.storageId(id), async () => {
    const stored = await store.get(id);
    if (!stored) throw new ProjectServiceError(404, `Project "${id}" not found`);
    try {
      await store.restoreHistory(id, entryId);
    } catch (error) {
      throw new ProjectServiceError(404, error instanceof Error ? error.message : "History entry not found");
    }
    await store.upsert(nextRevision(stored));
    return readProjectView(id, { locked: true });
  });
}

/** Records a deploy in the history; the project itself is unchanged (no new revision). */
export async function snapshotDeploy(id: string): Promise<void> {
  const store = getProjectStore();
  await withProjectLock(store.storageId(id), async () => {
    const existing = await store.listHistory(id);
    let max = 0;
    for (const entry of existing) {
      const match = /^v(\d+)$/.exec(entry.tag);
      if (match) max = Math.max(max, Number(match[1]));
    }
    await store.snapshotHistory(id, { tag: `v${max + 1}`, text: "Deployed", who: "local" });
  });
}

async function snapshotDraft(id: string, text: string): Promise<void> {
  await getProjectStore().snapshotHistory(id, { tag: "draft", text, who: "local" });
}

function safeDownloadName(name: string): string {
  const trimmed = name.replace(/[\\/:*?"<>|]+/g, " ").trim();
  return trimmed || "project";
}
