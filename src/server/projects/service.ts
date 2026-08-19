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
import type { ValidationIssue } from "@/core/validation/issue";
import { getProjectStore } from "../persistence";
import type { ProjectMeta, ProjectSource } from "../persistence/types";
import { ProjectServiceError } from "./errors";
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
  return Promise.all(metas.map((meta) => withFamily(store, meta)));
}

export async function getProjectView(id: string): Promise<ProjectView> {
  const store = getProjectStore();
  const stored = await store.get(id);
  if (!stored) throw new ProjectServiceError(404, `Project "${id}" not found`);
  const xml = await store.readXml(id);
  const doc = XmlDocument.parse(xml);
  const meta = await withFamily(store, stored, doc);
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
  opts: { id: string; name?: string; source?: ProjectSource },
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
  });
}

/** Open a gateway "complete" blob: validates length/CRC32/ZIP and extracts the XML. */
export async function openCompleteBlob(
  data: Uint8Array,
  opts: { id: string; name?: string; source?: ProjectSource },
): Promise<ProjectMeta> {
  const blob = parseCompleteBlob(data); // throws on bad length/CRC
  const ibmaps = extractIbmaps(blob.zip);
  const meta = await openIbmaps(ibmaps.xml, { ...opts, name: opts.name ?? ibmaps.name });
  await getProjectStore().writeCompleteBlob(meta.id, data);
  return meta;
}

/** Explicit demo project from the synthetic fixture — always labelled demo. */
export async function loadDemoProject(): Promise<ProjectMeta> {
  return persistNewProject("demo", SYNTHETIC_KNX_MBM_XML, "knx-mbm", {
    name: "Demo project (synthetic)",
    source: "demo",
  });
}

export async function applyPatches(id: string, patches: ProjectPatch[]): Promise<ProjectView> {
  const store = getProjectStore();
  const xml = await store.readXml(id);
  const doc = XmlDocument.parse(xml);
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
    family.applyPatch(doc, patch);
  }
  const serialized = doc.serialize();
  await store.writeXml(id, serialized);
  const meta = await store.get(id);
  if (meta) await store.upsert({ ...meta, updatedAt: new Date().toISOString() });
  return getProjectView(id);
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
): Promise<ProjectMeta> {
  const family = meta.family as FamilyId | undefined;
  if (family) return meta;
  const parsed = doc ?? XmlDocument.parse(await store.readXml(meta.id));
  const detected = detectFamily(parsed)?.id ?? "knx-mbm";
  const upgraded = { ...meta, family: detected };
  await store.upsert(upgraded);
  return upgraded;
}

async function persistNewProject(
  id: string,
  xml: string,
  family: FamilyId,
  opts: { name: string; source: ProjectSource },
): Promise<ProjectMeta> {
  const store = getProjectStore();
  const meta: ProjectMeta = {
    id,
    name: opts.name,
    description: XmlDocument.parse(xml).getAttr([], "ProjectDescription") ?? "",
    source: opts.source,
    family,
    updatedAt: new Date().toISOString(),
  };
  await store.writeXml(id, xml);
  await store.upsert(meta);
  return meta;
}
