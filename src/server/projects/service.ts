import "server-only";
import {
  buildCompleteBlob,
  buildProjectZip,
  extractIbmaps,
  parseCompleteBlob,
  XmlDocument,
} from "@/core/project-format";
import type { KnxMbmProject } from "@/gateway-families/knx-mbm";
import { projectFromXml as knxMbmProjectFromXml } from "@/gateway-families/knx-mbm";
import type { MeMbsProject } from "@/gateway-families/me-mbs";
import { projectFromXml as meMbsProjectFromXml } from "@/gateway-families/me-mbs";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { SYNTHETIC_ME_MBS_XML } from "@/gateway-families/me-mbs/fixtures/synthetic-project";
import type { ValidationIssue } from "@/core/validation/issue";
import { getProjectStore } from "../persistence";
import type { ProjectHistoryEntry, ProjectMeta, ProjectSource } from "../persistence/types";
import { buildKnxEsf } from "../exports/esf-knx";
import { buildPollPlanXlsx } from "../exports/xlsx-poll-plan";
import { buildSignalsXlsx } from "../exports/xlsx-signals";
import { applySignalsXlsx } from "../imports/xlsx-signals";
import { ProjectServiceError } from "./errors";
import { withProjectLock } from "./project-lock";
import {
  detectFamily,
  familyById,
  supportedFamiliesText,
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
  meta: ProjectMeta;
  issues: ValidationIssue[];
  /** Whether the original gateway "complete" blob is available for round-trip. */
  hasCompleteBlob: boolean;
}

/** Family-discriminated project view: `family` selects the model type. */
export type ProjectView =
  | (ProjectViewBase & { family: "knx-mbm"; project: KnxMbmProject })
  | (ProjectViewBase & { family: "me-mbs"; project: MeMbsProject });

export async function listProjects(): Promise<ProjectMeta[]> {
  const store = getProjectStore();
  const metas = await store.list();
  // Backfill the family field for projects stored before it existed.
  return Promise.all(metas.map(async (meta) => withRevision(await withFamily(store, meta))));
}

export async function getProjectView(id: string): Promise<ProjectView> {
  return readProjectView(id, { locked: false });
}

/** `locked`: the caller already holds the project lock (writes return the new view). */
async function readProjectView(id: string, { locked }: { locked: boolean }): Promise<ProjectView> {
  const store = getProjectStore();
  const stored = await store.get(id);
  if (!stored) throw new ProjectServiceError(404, `Project "${id}" not found`);
  // A family backfill rewrites the meta, so that read (meta + XML) happens
  // entirely under the lock: otherwise a newer meta could pair with an older XML.
  if (!stored.family && !locked) {
    return withProjectLock(store.storageId(id), () => readProjectView(id, { locked: true }));
  }
  const xml = await store.readXml(id);
  const doc = XmlDocument.parse(xml);
  const meta = withRevision(await withFamily(store, stored, doc, true));
  const hasCompleteBlob = await store.hasCompleteBlob(id);
  if (meta.family === "me-mbs") {
    const project = meMbsProjectFromXml(doc);
    return { family: "me-mbs", meta, project, issues: familyById("me-mbs").validate(project), hasCompleteBlob };
  }
  const project = knxMbmProjectFromXml(doc);
  return { family: "knx-mbm", meta, project, issues: familyById("knx-mbm").validate(project), hasCompleteBlob };
}

/** Open a local .ibmaps XML text as a project. */
export async function openIbmaps(
  xml: string,
  opts: { id: string; name?: string; source?: ProjectSource; completeBlob?: Uint8Array },
): Promise<ProjectMeta> {
  const doc = XmlDocument.parse(xml);
  const family = detectFamily(doc);
  if (!family) {
    throw new ProjectServiceError(
      422,
      `The file is not a supported project. Supported families: ${supportedFamiliesText()}.`,
    );
  }
  return persistNewProject(opts.id, xml, family.id, {
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
  const xml = family === "me-mbs" ? SYNTHETIC_ME_MBS_XML : SYNTHETIC_KNX_MBM_XML;
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
    const doc = XmlDocument.parse(await store.readXml(id));
    const family = detectFamily(doc);
    if (!family) {
      throw new ProjectServiceError(422, `Project "${id}" is not a supported project.`);
    }
    for (const patch of patches) {
      if (!family.accepts(patch)) {
        throw new ProjectServiceError(
          409,
          `Patch "${patch.type}" does not apply to a ${family.displayName} project.`,
        );
      }
    }
    family.applyPatches(doc, patches);
    await store.writeXml(id, doc.serialize());
    await store.upsert(nextRevision(stored));
    await snapshotDraft(id, "Edited project");
    return readProjectView(id, { locked: true });
  });
}

/** Rebuild the "complete" blob with the current XML and the ORIGINAL XBL. */
export async function exportCompleteBlob(id: string): Promise<Uint8Array> {
  const store = getProjectStore();
  const xml = await store.readXml(id);
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

export async function exportSignalsXlsx(
  id: string,
): Promise<{ filename: string; body: Buffer; contentType: string }> {
  const view = await getProjectView(id);
  const body = await buildSignalsXlsx(view.family, view.project);
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
  const store = getProjectStore();
  const xml = await store.readXml(id);
  const body = await buildPollPlanXlsx(XmlDocument.parse(xml), { projectName: view.meta.name });
  return {
    filename: `${safeDownloadName(view.meta.name)} poll-plan.xlsx`,
    body,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

export async function importSignalsXlsx(id: string, data: Uint8Array, fileName: string): Promise<ProjectView> {
  const store = getProjectStore();
  return withProjectLock(store.storageId(id), async () => {
    const stored = await store.get(id);
    if (!stored) throw new ProjectServiceError(404, `Project "${id}" not found`);
    const xml = await store.readXml(id);
    const doc = XmlDocument.parse(xml);
    const family = detectFamily(doc);
    if (!family) throw new ProjectServiceError(422, `Project "${id}" is not a supported project.`);
    const result = await applySignalsXlsx(doc, family.id, data);
    await store.writeXml(id, doc.serialize());
    const now = new Date().toISOString();
    await store.upsert(nextRevision(stored, { lastImport: { fileName, at: now, rows: result.rows } }));
    await snapshotDraft(id, `Imported ${fileName}`);
    return readProjectView(id, { locked: true });
  });
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
